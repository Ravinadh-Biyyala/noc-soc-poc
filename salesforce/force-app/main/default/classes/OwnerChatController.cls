/**
 * LWC entry point for the Owner Assistant. Orchestrates the pipeline:
 *   resolve owner scope -> build catalog -> LLM writes SOQL -> SoqlGuard sanitizes
 *   -> route to SoqlExecutor (local) or ExternalOrgQueryService (external org)
 *   -> LLM composes the answer.
 *
 * `with sharing` is deliberate and load-bearing: combined with USER_MODE in
 * SoqlExecutor it guarantees the running owner can only ever read their own records.
 * External-org queries use Named Credential OAuth — no local sharing rules apply,
 * but SoqlGuard's allow-list and LIMIT cap still protect the call.
 */
public with sharing class OwnerChatController {

    private static final Integer MAX_QUESTION_LENGTH = 1000;
    private static final Integer MAX_HISTORY_TURNS = 8;

    public class ChatResponse {
        @AuraEnabled public String answer;
        @AuraEnabled public Boolean hasData = false;
        @AuraEnabled public List<String> columns = new List<String>();
        @AuraEnabled public List<Map<String, Object>> rows = new List<Map<String, Object>>();
        @AuraEnabled public String generatedSoql; // populated only for debug-permissioned users
    }

    /**
     * @param question free-text owner question
     * @param history  prior turns as [{role:'user'|'assistant', content:'...'}], oldest first
     */
    @AuraEnabled(cacheable=false)
    public static ChatResponse askQuestion(String question, List<Map<String, String>> history) {
        try {
            if (String.isBlank(question)) {
                throw new OwnerAssistantException('Please type a question.');
            }
            if (question.length() > MAX_QUESTION_LENGTH) {
                throw new OwnerAssistantException('That question is too long. Please shorten it.');
            }

            List<Map<String, String>> trimmedHistory = trimHistory(history);
            OwnerContextService.OwnerScope scope = OwnerContextService.getOwnerScope();

            Map<String, SchemaCatalogService.ObjectMeta> catalog = SchemaCatalogService.getCatalog();
            if (catalog.isEmpty()) {
                throw new OwnerAssistantException('The assistant is not configured yet. Please contact support.');
            }
            String schemaDoc = SchemaCatalogService.buildSchemaDoc(catalog);

            ChatResponse resp = new ChatResponse();

            LlmService.SoqlPlan plan = LlmService.generateSoql(question, schemaDoc, trimmedHistory);
            if (plan.needsData != true || String.isBlank(plan.soql)) {
                // No data lookup needed (greeting, out-of-scope, etc.).
                resp.answer = LlmService.composeAnswer(question, '[]', trimmedHistory);
                return resp;
            }

            SoqlGuard.GuardResult guard = SoqlGuard.sanitize(plan.soql, scope, catalog);

            SoqlExecutor.QueryResult qr;
            if (guard.isExternal) {
                // Route to external org via Named Credential callout.
                qr = ExternalOrgQueryService.run(guard.soql, guard.externalNamedCredential);
            } else {
                // Local org query with USER_MODE + owner-scope bind.
                qr = SoqlExecutor.run(guard.soql, guard.binds);
            }

            resp.answer = LlmService.composeAnswer(question, qr.rowsJson, trimmedHistory);
            resp.hasData = qr.size > 0;
            resp.columns = qr.columns;
            resp.rows = qr.rows;
            if (canSeeDebug()) {
                resp.generatedSoql = guard.soql;
            }
            return resp;

        } catch (OwnerAssistantException e) {
            // Safe, user-facing message.
            throw asAura(e.getMessage());
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Owner Assistant unexpected error: ' + e.getMessage() + '\n' + e.getStackTraceString());
            throw asAura('Something went wrong. Please try again in a moment.');
        }
    }

    private static List<Map<String, String>> trimHistory(List<Map<String, String>> history) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        if (history == null) {
            return out;
        }
        Integer start = Math.max(0, history.size() - MAX_HISTORY_TURNS);
        for (Integer i = start; i < history.size(); i++) {
            out.add(history[i]);
        }
        return out;
    }

    private static Boolean canSeeDebug() {
        return FeatureManagement.checkPermission('Owner_Assistant_Debug');
    }

    private static AuraHandledException asAura(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}
