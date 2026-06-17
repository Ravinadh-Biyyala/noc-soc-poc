/**
 * Builds the data catalog that defines what the assistant is allowed to read.
 *
 * The catalog is sourced ENTIRELY from active Owner_Assistant_Object__mdt records.
 * It serves two jobs:
 *   1. produce the human-readable schema doc handed to the LLM (so it only ever
 *      "knows about" allow-listed objects/fields), and
 *   2. expose the allow-list map that SoqlGuard enforces before execution.
 *
 * The catalog is cached per-transaction; an optional Platform Cache layer can be
 * added later for cross-request reuse.
 */
public with sharing class SchemaCatalogService {

    public class ObjectMeta {
        public String apiName;
        public String ownerScopeField;
        public String description;
        public List<String> allowedFields = new List<String>();
        public Set<String> allowedFieldSet = new Set<String>();
        public Boolean isExternal = false;
        public String externalNamedCredential;
    }

    // Transaction-level cache. @TestVisible so tests can inject a catalog without
    // depending on deployed custom metadata records.
    @TestVisible
    private static Map<String, ObjectMeta> cachedCatalog;

    /** @return map of lower-cased object API name -> ObjectMeta for every active allow-list entry. */
    public static Map<String, ObjectMeta> getCatalog() {
        if (cachedCatalog != null) {
            return cachedCatalog;
        }

        Map<String, ObjectMeta> catalog = new Map<String, ObjectMeta>();
        for (Owner_Assistant_Object__mdt row : [
            SELECT Object_API_Name__c, Owner_Scope_Field__c, Allowed_Fields__c, Description__c,
                   Is_External__c, External_Named_Credential__c
            FROM Owner_Assistant_Object__mdt
            WHERE Is_Active__c = true
        ]) {
            ObjectMeta meta = new ObjectMeta();
            meta.apiName = row.Object_API_Name__c == null ? '' : row.Object_API_Name__c.trim();
            meta.ownerScopeField = row.Owner_Scope_Field__c == null ? '' : row.Owner_Scope_Field__c.trim();
            meta.description = row.Description__c;
            meta.isExternal = row.Is_External__c == true;
            meta.externalNamedCredential = row.External_Named_Credential__c == null
                ? '' : row.External_Named_Credential__c.trim();
            for (String f : splitFields(row.Allowed_Fields__c)) {
                meta.allowedFields.add(f);
                meta.allowedFieldSet.add(f.toLowerCase());
            }
            if (String.isNotBlank(meta.apiName)) {
                catalog.put(meta.apiName.toLowerCase(), meta);
            }
        }
        cachedCatalog = catalog;
        return catalog;
    }

    /** Splits a comma/newline-separated field list into trimmed, non-empty names. */
    private static List<String> splitFields(String raw) {
        List<String> out = new List<String>();
        if (String.isBlank(raw)) {
            return out;
        }
        for (String part : raw.split('[,\\n\\r]')) {
            String t = part.trim();
            if (String.isNotBlank(t)) {
                out.add(t);
            }
        }
        return out;
    }

    /** Renders the catalog as the schema doc embedded in the LLM system prompt. */
    public static String buildSchemaDoc(Map<String, ObjectMeta> catalog) {
        List<String> lines = new List<String>();
        for (ObjectMeta meta : catalog.values()) {
            String source = meta.isExternal ? ' [external org]' : '';
            lines.add(
                'OBJECT ' + meta.apiName + source +
                (String.isBlank(meta.description) ? '' : ' — ' + meta.description)
            );
            lines.add('  fields: ' + String.join(meta.allowedFields, ', '));
        }
        return String.join(lines, '\n');
    }
}
