UPDATE extensions
SET schema_json = json_set(
    schema_json,
    '$.dataplane',
    json('{"kind":"aurora_access","list_rules":[{"config_key":"whitelist","action":"allow","priority":10},{"config_key":"blacklist","action":"block","priority":20}],"table_rule":{"config_key":"rules","cidr_key":"cidr","type_key":"type","allow_type":"whitelist","block_type":"blacklist","path_key":"match_value","action_key":"action"}}')
)
WHERE id = 'ip-restriction';
