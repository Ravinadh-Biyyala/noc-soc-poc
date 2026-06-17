/**
 * Executes a SOQL query against an external Salesforce org via REST API callout,
 * using a Named Credential for authentication. Returns results in the same
 * SoqlExecutor.QueryResult shape so OwnerChatController can treat local and
 * external results identically.
 *
 * The Named Credential (e.g. DevOrg_NC) must be configured in Setup with OAuth
 * credentials for the target org before this service can be called.
 */
public with sharing class ExternalOrgQueryService {

    private static final String API_VERSION = 'v64.0';

    /**
     * @param soql             Sanitized SOQL (no bind variables — already cleaned by SoqlGuard).
     * @param namedCredential  Developer name of the Named Credential for the target org.
     */
    public static SoqlExecutor.QueryResult run(String soql, String namedCredential) {
        if (String.isBlank(namedCredential)) {
            throw new OwnerAssistantException(
                'External org is not configured. Please contact your administrator.'
            );
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint(
            'callout:' + namedCredential +
            '/services/data/' + API_VERSION + '/query?q=' +
            EncodingUtil.urlEncode(soql, 'UTF-8')
        );
        req.setMethod('GET');
        req.setHeader('Accept', 'application/json');
        req.setTimeout(30000);

        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (System.CalloutException e) {
            System.debug(LoggingLevel.ERROR,
                'ExternalOrgQueryService: callout exception — ' + e.getMessage());
            throw new OwnerAssistantException(
                'Could not reach the external system. Please try again.'
            );
        }

        if (res.getStatusCode() != 200) {
            System.debug(LoggingLevel.ERROR,
                'ExternalOrgQueryService: HTTP ' + res.getStatusCode() +
                ' — ' + res.getBody()
            );
            throw new OwnerAssistantException(
                'The external system returned an error (' + res.getStatusCode() +
                '). Please try a different question.'
            );
        }

        return parseQueryResponse(res.getBody());
    }

    private static SoqlExecutor.QueryResult parseQueryResponse(String body) {
        Map<String, Object> payload =
            (Map<String, Object>) JSON.deserializeUntyped(body);

        List<Object> records = (List<Object>) payload.get('records');

        SoqlExecutor.QueryResult qr = new SoqlExecutor.QueryResult();
        List<String> columnOrder = new List<String>();
        Set<String> seenColumns = new Set<String>();

        if (records != null) {
            for (Object recObj : records) {
                Map<String, Object> rec = (Map<String, Object>) recObj;
                Map<String, Object> flat = new Map<String, Object>();
                for (String key : rec.keySet()) {
                    if (key == 'attributes') {
                        continue;
                    }
                    flat.put(key, rec.get(key));
                    if (!seenColumns.contains(key)) {
                        seenColumns.add(key);
                        columnOrder.add(key);
                    }
                }
                qr.rows.add(flat);
            }
        }

        qr.columns = columnOrder;
        qr.size = qr.rows.size();
        qr.rowsJson = JSON.serialize(qr.rows);
        return qr;
    }
}
