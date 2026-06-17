/**
 * The security heart of the assistant. Takes the SOQL the LLM proposed and either
 * rejects it or returns a sanitized, owner-scoped, bind-parameterized query that is
 * safe to run. This is layer two of three (allow-list + scope injection); `with
 * sharing` + USER_MODE in SoqlExecutor is the final backstop.
 *
 * Hard rules enforced here:
 *   - exactly one read-only SELECT statement (no DML, no FOR UPDATE, no ';')
 *   - no bind variables from the LLM (we inject our own owner-scope bind)
 *   - no child relationship subqueries
 *   - FROM object MUST be in the allow-list
 *   - an owner-scope predicate is injected on every LOCAL query, using a bind variable
 *   - external-org queries skip scope injection (scoping is across-org meaningless)
 *   - a LIMIT of <= 200 is guaranteed
 */
public with sharing class SoqlGuard {

    private static final Integer MAX_LIMIT = 200;
    public static final String SCOPE_BIND = 'ownerScopeId';

    public class GuardResult {
        public String soql;
        public Map<String, Object> binds;
        public Boolean isExternal = false;
        public String externalNamedCredential;
    }

    private static final Pattern DML_TOKENS =
        Pattern.compile('(?i)\\b(insert|update|delete|upsert|undelete|merge)\\b');
    private static final Pattern FOR_UPDATE =
        Pattern.compile('(?i)\\bfor\\s+update\\b');
    private static final Pattern SUBQUERY =
        Pattern.compile('(?i)\\(\\s*select\\b');
    private static final Pattern FROM_OBJECT =
        Pattern.compile('(?i)\\bfrom\\s+([a-z0-9_]+)');
    private static final Pattern FROM_KEYWORD =
        Pattern.compile('(?i)\\bfrom\\b');
    private static final Pattern LIMIT_CLAUSE =
        Pattern.compile('(?i)\\blimit\\s+(\\d+)');

    // Clause keywords that can follow a WHERE condition, used to find where the
    // condition ends so we can AND the owner predicate onto it.
    private static final List<String> POST_WHERE_CLAUSES = new List<String>{
        ' with ', ' group by ', ' having ', ' order by ', ' limit ', ' offset '
    };

    public static GuardResult sanitize(
        String rawSoql,
        OwnerContextService.OwnerScope scope,
        Map<String, SchemaCatalogService.ObjectMeta> catalog
    ) {
        if (String.isBlank(rawSoql)) {
            throw new OwnerAssistantException('I could not build a query for that. Please rephrase.');
        }

        // Collapse whitespace so clause parsing is predictable; strip a trailing ';'.
        String soql = rawSoql.replaceAll('\\s+', ' ').trim();
        if (soql.endsWith(';')) {
            soql = soql.substring(0, soql.length() - 1).trim();
        }

        String lower = soql.toLowerCase();

        // --- structural rejections ------------------------------------------
        if (!lower.startsWith('select ')) {
            throw new OwnerAssistantException('Only read queries are supported.');
        }
        if (soql.contains(';')) {
            throw new OwnerAssistantException('Only a single query is allowed.');
        }
        if (soql.contains(':')) {
            // The LLM must not supply binds; we inject the only one allowed.
            throw new OwnerAssistantException('That query is not allowed.');
        }
        if (DML_TOKENS.matcher(soql).find() || FOR_UPDATE.matcher(soql).find()) {
            throw new OwnerAssistantException('Only read-only queries are permitted.');
        }
        if (SUBQUERY.matcher(soql).find()) {
            throw new OwnerAssistantException('That question is too complex for me to answer safely yet.');
        }

        // --- resolve & allow-list the FROM object ----------------------------
        Matcher fromKw = FROM_KEYWORD.matcher(soql);
        Integer fromCount = 0;
        while (fromKw.find()) {
            fromCount++;
        }
        if (fromCount != 1) {
            throw new OwnerAssistantException('That query references more than one object.');
        }

        Matcher fromMatcher = FROM_OBJECT.matcher(soql);
        if (!fromMatcher.find()) {
            throw new OwnerAssistantException('I could not determine which object to query.');
        }
        String objectName = fromMatcher.group(1);
        SchemaCatalogService.ObjectMeta meta = catalog.get(objectName.toLowerCase());
        if (meta == null) {
            throw new OwnerAssistantException('I am not able to access that information.');
        }

        // --- inject the owner-scope predicate (local objects only) -----------
        // External-org queries skip scope injection: the scope field lives in the
        // local org and is meaningless as a cross-org WHERE predicate.
        Boolean scoped = false;
        if (!meta.isExternal) {
            scoped = String.isNotBlank(meta.ownerScopeField) && scope.accountId != null;
            if (scoped) {
                String ownerPredicate = meta.ownerScopeField + ' = :' + SCOPE_BIND;
                soql = injectOwnerScope(soql, ownerPredicate);
            } else {
                System.debug(LoggingLevel.WARN,
                    'Owner Assistant: query NOT owner-scoped (dev mode or no scope field) for ' + objectName);
            }
        }

        // --- guarantee a safe LIMIT ------------------------------------------
        soql = enforceLimit(soql);

        GuardResult result = new GuardResult();
        result.soql = soql;
        result.binds = scoped
            ? new Map<String, Object>{ SCOPE_BIND => scope.accountId }
            : new Map<String, Object>();
        result.isExternal = meta.isExternal;
        result.externalNamedCredential = meta.externalNamedCredential;
        return result;
    }

    /** Wraps any existing WHERE condition and ANDs the owner predicate, or adds a WHERE. */
    private static String injectOwnerScope(String soql, String ownerPredicate) {
        String lower = soql.toLowerCase();
        Integer whereIdx = lower.indexOf(' where ');

        if (whereIdx >= 0) {
            Integer condStart = whereIdx + ' where '.length();
            Integer boundary = firstPostWhereBoundary(lower, condStart);
            if (boundary < 0) {
                boundary = soql.length();
            }
            String cond = soql.substring(condStart, boundary).trim();
            String rebuilt =
                soql.substring(0, whereIdx) +
                ' WHERE (' + cond + ') AND ' + ownerPredicate + ' ' +
                soql.substring(boundary);
            return rebuilt.replaceAll('\\s+', ' ').trim();
        }

        // No WHERE: insert one before the first trailing clause, else append.
        Integer boundary = firstPostWhereBoundary(lower, 0);
        if (boundary < 0) {
            return soql + ' WHERE ' + ownerPredicate;
        }
        return (soql.substring(0, boundary) + ' WHERE ' + ownerPredicate + ' ' + soql.substring(boundary))
            .replaceAll('\\s+', ' ').trim();
    }

    /** Index of the earliest trailing clause keyword at/after fromIdx, or -1. */
    private static Integer firstPostWhereBoundary(String lower, Integer fromIdx) {
        Integer best = -1;
        for (String kw : POST_WHERE_CLAUSES) {
            Integer i = lower.indexOf(kw, fromIdx);
            if (i >= 0 && (best == -1 || i < best)) {
                best = i;
            }
        }
        return best;
    }

    /** Caps an existing LIMIT to MAX_LIMIT or appends one if missing. */
    private static String enforceLimit(String soql) {
        Matcher m = LIMIT_CLAUSE.matcher(soql);
        if (m.find()) {
            Integer requested = Integer.valueOf(m.group(1));
            Integer capped = Math.min(requested, MAX_LIMIT);
            return m.replaceFirst('LIMIT ' + capped);
        }
        return soql + ' LIMIT ' + MAX_LIMIT;
    }
}
