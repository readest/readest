-- Unexpected statuses raise { response = ..., reason = ... } in lua-Spore.
-- Also accept plain responses returned for statuses listed in the spec.
return function(result)
    if type(result) ~= "table" then return nil, tostring(result) end
    local response = type(result.response) == "table" and result.response or result
    return response, result.reason
end
