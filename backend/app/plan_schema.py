PLAN_SCHEMA = {
  "type":"object",
  "required":["summary","phases","evac_routes","resources","communications","risks"],
  "properties":{
    "summary":{"type":"string"},
    "phases":{"type":"array","items":{
      "type":"object",
      "required":["name","actions"],
      "properties":{
        "name":{"type":"string"},
        "eta_minutes":{"type":"array","items":{"type":"number"}},
        "actions":{"type":"array","items":{"type":"string"}}
      }
    }},
    "evac_routes":{"type":"array","items":{
      "type":"object",
      "required":["purpose"],
      "properties":{
        "purpose":{"type":"string"},
        "start":{"type":"array","items":{"type":"number"}, "minItems":2, "maxItems":2},
        "end":{"type":"array","items":{"type":"number"}, "minItems":2, "maxItems":2},
        "notes":{"type":"string"}
      }
    }},
    "resources":{"type":"object","additionalProperties":{"type":"array","items":{"type":"string"}}},
    "communications":{"type":"array","items":{"type":"string"}},
    "risks":{"type":"array","items":{"type":"string"}}
  },
  "additionalProperties": False
}
