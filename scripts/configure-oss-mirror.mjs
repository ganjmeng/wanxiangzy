import { createHash, createHmac } from "node:crypto";

const bucket = required("ALIYUN_OSS_BUCKET");
const region = required("ALIYUN_OSS_REGION");
const accessKeyId = required("ALIYUN_OSS_ACCESS_KEY_ID");
const accessKeySecret = required("ALIYUN_OSS_ACCESS_KEY_SECRET");
const securityToken = process.env.ALIYUN_OSS_SECURITY_TOKEN?.trim() || "";
const signingSecret = required("ALIYUN_OSS_MIRROR_SIGNING_SECRET");
const encryptionKey = required("ADMIN_SECRETS_ENCRYPTION_KEY");
const allowedHosts = required("ALIYUN_OSS_MIRROR_ALLOWED_HOSTS")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
if (signingSecret.length < 32 || /replace-with|change-me/i.test(signingSecret)) {
  fail("ALIYUN_OSS_MIRROR_SIGNING_SECRET must be a non-placeholder secret with at least 32 characters");
}
if (!/^(?:hex:)?[a-f0-9]{64}$/i.test(encryptionKey)) {
  fail("ADMIN_SECRETS_ENCRYPTION_KEY must be a 32-byte hex key");
}
if (!allowedHosts.length || allowedHosts.some((host) => (
  host === "*"
  || host.includes(":")
  || host.includes("/")
  || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
))) {
  fail("ALIYUN_OSS_MIRROR_ALLOWED_HOSTS must contain explicit valid provider hostnames");
}

const generatedPrefix = normalizePrefix(
  process.env.ALIYUN_OSS_GENERATED_PREFIX || process.env.ALIYUN_OSS_PREFIX || "generated-results/original",
);
const mirrorPrefix = normalizePrefix(process.env.ALIYUN_OSS_MIRROR_PREFIX || `${generatedPrefix}/mirror`);
const appUrl = (process.env.ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "")
  .trim()
  .replace(/\/+$/, "");
const resolverUrl = process.env.ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL
  ? `${appUrl}/`
  : `${appUrl}/api/oss-mirror-source/`;

let parsedResolver;
try {
  parsedResolver = new URL(resolverUrl);
} catch {
  fail("set NEXT_PUBLIC_APP_URL or ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL to the public resolver URL");
}
if (parsedResolver.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsedResolver.hostname)) {
  fail("OSS mirror resolver must be a public HTTPS URL");
}

const endpoint = `${bucket}.${region}.aliyuncs.com`;
const checkOnly = process.argv.includes("--check");
await checkResolverHealth();
const existing = await websiteRequest("GET");

if (existing.status === 200) {
  const xml = await existing.text();
  const configured = hasExactMirrorRule(xml);
  if (!configured) {
    fail(
      "bucket already has a Website configuration; refusing to overwrite it. "
      + "Merge the generated RoutingRule manually or remove the old configuration after review.",
    );
  }
  console.log(`OSS mirror rule is configured for prefix ${mirrorPrefix}/`);
  process.exit(0);
}

if (existing.status !== 404) {
  fail(`GetBucketWebsite failed: HTTP ${existing.status} ${(await existing.text()).slice(0, 300)}`);
}
if (checkOnly) fail("OSS mirror rule is not configured");

const websiteXml = `<?xml version="1.0" encoding="UTF-8"?>
<WebsiteConfiguration>
  <RoutingRules>
    <RoutingRule>
      <RuleNumber>1</RuleNumber>
      <Condition>
        <KeyPrefixEquals>${escapeXml(mirrorPrefix)}/</KeyPrefixEquals>
        <HttpErrorCodeReturnedEquals>404</HttpErrorCodeReturnedEquals>
      </Condition>
      <Redirect>
        <RedirectType>Mirror</RedirectType>
        <MirrorURL>${escapeXml(resolverUrl)}</MirrorURL>
        <MirrorPassQueryString>false</MirrorPassQueryString>
        <MirrorFollowRedirect>true</MirrorFollowRedirect>
        <MirrorCheckMd5>false</MirrorCheckMd5>
      </Redirect>
    </RoutingRule>
  </RoutingRules>
</WebsiteConfiguration>`;

const put = await websiteRequest("PUT", websiteXml);
if (!put.ok) fail(`PutBucketWebsite failed: HTTP ${put.status} ${(await put.text()).slice(0, 500)}`);

const verify = await websiteRequest("GET");
const verifyXml = await verify.text();
if (!verify.ok || !hasExactMirrorRule(verifyXml)) {
  fail(`OSS mirror rule verification failed: HTTP ${verify.status}`);
}
console.log(`Configured OSS mirror rule for prefix ${mirrorPrefix}/ -> ${parsedResolver.origin}`);

async function websiteRequest(method, body = "") {
  const date = new Date().toUTCString();
  const contentType = body ? "application/xml" : "";
  const contentMd5 = body ? createHash("md5").update(body).digest("base64") : "";
  const canonicalizedResource = `/${bucket}/?website`;
  const canonicalizedOssHeaders = securityToken
    ? `x-oss-security-token:${securityToken}\n`
    : "";
  const stringToSign = [
    method,
    contentMd5,
    contentType,
    date,
    `${canonicalizedOssHeaders}${canonicalizedResource}`,
  ].join("\n");
  const signature = createHmac("sha1", accessKeySecret).update(stringToSign).digest("base64");
  return fetch(`https://${endpoint}/?website`, {
    method,
    headers: {
      Authorization: `OSS ${accessKeyId}:${signature}`,
      Date: date,
      ...(securityToken ? { "x-oss-security-token": securityToken } : {}),
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(contentMd5 ? { "Content-MD5": contentMd5 } : {}),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(30_000),
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing ${name}`);
  return value;
}

function normalizePrefix(value) {
  const prefix = value.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..") || /[\\?#]/.test(prefix)) fail("invalid OSS mirror prefix");
  return prefix;
}

async function checkResolverHealth() {
  const healthUrl = new URL("__health", resolverUrl).toString();
  let response;
  try {
    response = await fetch(healthUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    fail(`OSS mirror resolver health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status !== 204) {
    fail(`OSS mirror resolver health check failed: HTTP ${response.status}`);
  }
}

function hasExactMirrorRule(xml) {
  const rules = xml.match(/<RoutingRule>[^]*?<\/RoutingRule>/g) || [];
  return rules.some((rule) => {
    const exact = tagValue(rule, "KeyPrefixEquals") === `${mirrorPrefix}/`
      && tagValue(rule, "HttpErrorCodeReturnedEquals") === "404"
      && tagValue(rule, "RedirectType") === "Mirror"
      && tagValue(rule, "MirrorURL") === resolverUrl
      && tagValue(rule, "MirrorPassQueryString") === "false"
      && tagValue(rule, "MirrorFollowRedirect") === "true"
      && tagValue(rule, "MirrorCheckMd5") === "false";
    return exact && !/<MirrorHeaders(?:\s|>)/.test(rule);
  });
}

function tagValue(xml, tag) {
  const match = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`).exec(xml);
  return match ? unescapeXml(match[1].trim()) : "";
}

function unescapeXml(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fail(message) {
  console.error(`[oss-mirror] ${message}`);
  process.exit(1);
}
