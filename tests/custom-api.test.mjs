import test from "node:test"
import assert from "node:assert/strict"
import {
  validateCustomApiConfig,
  parseUploadedApiConfig,
  getSampleApiConfigTemplate,
  getSamplePythonFastAPICode,
  DEFAULT_CUSTOM_API
} from "../lib/settings.ts"

test("validateCustomApiConfig validates endpoint URLs correctly", () => {
  // Empty or missing
  assert.equal(validateCustomApiConfig({}).valid, false)
  assert.equal(validateCustomApiConfig({ endpoint: "" }).valid, false)

  // Non-HTTP protocol
  assert.equal(validateCustomApiConfig({ endpoint: "ftp://example.com" }).valid, false)
  assert.equal(validateCustomApiConfig({ endpoint: "invalid-url" }).valid, false)

  // Valid URLs
  assert.equal(validateCustomApiConfig({ endpoint: "http://localhost:8000/api/tryon" }).valid, true)
  assert.equal(validateCustomApiConfig({ endpoint: "https://api.my-vton.com/v1/predict" }).valid, true)

  // Invalid health check URL
  assert.equal(validateCustomApiConfig({
    endpoint: "http://localhost:8000/api/tryon",
    healthEndpoint: "not-a-url"
  }).valid, false)

  // Valid health check URL
  assert.equal(validateCustomApiConfig({
    endpoint: "http://localhost:8000/api/tryon",
    healthEndpoint: "http://localhost:8000/health"
  }).valid, true)
})

test("parseUploadedApiConfig correctly imports user API configuration JSON", () => {
  // 1. Direct custom API json
  const json1 = JSON.stringify({
    name: "FastVITON Server",
    endpoint: "http://localhost:8000/tryon",
    apiKey: "secret-token-123",
    format: "rest-json",
    authType: "bearer"
  })

  const res1 = parseUploadedApiConfig(json1)
  assert.equal(res1.success, true)
  assert.equal(res1.config?.name, "FastVITON Server")
  assert.equal(res1.config?.endpoint, "http://localhost:8000/tryon")
  assert.equal(res1.config?.apiKey, "secret-token-123")
  assert.equal(res1.config?.format, "rest-json")
  assert.equal(res1.config?.authType, "bearer")
  assert.equal(res1.provider, "custom")

  // 2. Wrapped or alias fields (apiUrl, api_key, auth_header_name)
  const json2 = JSON.stringify({
    apiUrl: "https://my-vton.com/api/predict",
    api_key: "key-xyz",
    auth_header_name: "X-Custom-Auth",
    format: "rest-form",
    person_field: "model_image",
    garment_field: "cloth_image"
  })

  const res2 = parseUploadedApiConfig(json2)
  assert.equal(res2.success, true)
  assert.equal(res2.config?.endpoint, "https://my-vton.com/api/predict")
  assert.equal(res2.config?.apiKey, "key-xyz")
  assert.equal(res2.config?.authHeaderName, "X-Custom-Auth")
  assert.equal(res2.config?.format, "rest-form")
  assert.equal(res2.config?.personField, "model_image")
  assert.equal(res2.config?.garmentField, "cloth_image")

  // 3. Malformed JSON
  const res3 = parseUploadedApiConfig("{ malformed json")
  assert.equal(res3.success, false)
  assert.ok(res3.error?.includes("JSON"))

  // 4. Missing endpoint
  const res4 = parseUploadedApiConfig(JSON.stringify({ name: "No Endpoint" }))
  assert.equal(res4.success, false)
})

test("getSampleApiConfigTemplate produces a valid, parsable template", () => {
  const templateStr = getSampleApiConfigTemplate()
  assert.ok(typeof templateStr === "string")
  
  const parsed = JSON.parse(templateStr)
  assert.ok(parsed.endpoint)
  assert.equal(parsed.format, "rest-json")

  const importResult = parseUploadedApiConfig(templateStr)
  assert.equal(importResult.success, true)
  assert.equal(importResult.config?.endpoint, "http://localhost:8000/api/tryon")
})

test("getSamplePythonFastAPICode provides runnable server boilerplate", () => {
  const code = getSamplePythonFastAPICode()
  assert.ok(code.includes("FastAPI"))
  assert.ok(code.includes("/api/tryon"))
  assert.ok(code.includes("person_image"))
  assert.ok(code.includes("garment_image"))
})
