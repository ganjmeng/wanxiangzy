#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_ROLES, type AdminRole } from "../lib/admin/permissions";

const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_ROLE: AdminRole = "owner";

type AuthUserSummary = {
  id: string;
  email?: string | null;
};

type UserLookupClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: AuthUserSummary[]; nextPage?: number | null };
        error: { message: string } | null;
      }>;
    };
  };
};

const { values } = parseArgs({
  options: {
    email: { type: "string", short: "e" },
    password: { type: "string", short: "p" },
    role: { type: "string", short: "r" },
    "display-name": { type: "string" },
    "update-password": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  printUsage();
  process.exit(0);
}

void main().catch((error) => {
  console.error(`Admin account creation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  const email = normalizeEmail(values.email || process.env.ADMIN_BOOTSTRAP_EMAIL || "");
  if (!email || !email.includes("@")) {
    throw new Error("provide --email owner@example.com or ADMIN_BOOTSTRAP_EMAIL");
  }

  const role = parseRole(values.role || process.env.ADMIN_BOOTSTRAP_ROLE || DEFAULT_ROLE);
  const displayName = (
    values["display-name"] ||
    process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME ||
    email.split("@")[0]
  ).trim();
  const suppliedPassword = values.password || process.env.ADMIN_BOOTSTRAP_PASSWORD || "";

  if (suppliedPassword && suppliedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existingUser = await findUserByEmail(admin, email);
  let userId = existingUser?.id || "";
  let created = false;
  let userExisted = Boolean(existingUser);
  let password = "";

  if (!existingUser) {
    password = suppliedPassword || generatePassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (error || !data.user) {
      if (!isAlreadyRegisteredError(error)) {
        throw new Error(`Supabase Auth createUser failed: ${error?.message || "unknown error"}`);
      }
      const racedUser = await findUserByEmail(admin, email);
      if (!racedUser) {
        throw new Error("Supabase Auth reported an existing user but it could not be loaded");
      }
      userId = racedUser.id;
      userExisted = true;
      password = "";
    } else {
      userId = data.user.id;
      created = true;
    }
  } else {
    userId = existingUser.id;
  }

  if (userExisted && values["update-password"]) {
    password = suppliedPassword || generatePassword();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw new Error(`Supabase Auth updateUserById failed: ${error.message}`);
  }

  const { data: member, error: memberError } = await admin
    .from("admin_members")
    .upsert({
      user_id: userId,
      email,
      role,
      status: "active",
      enabled: true,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("user_id,email,role,status,enabled,display_name")
    .single();

  if (memberError || !member) {
    throw new Error(
      `admin_members write failed: ${memberError?.message || "unknown error"}. ` +
      "Apply supabase/admin-console.sql before running this command.",
    );
  }

  console.log("Admin account is ready.");
  console.log(`  Email: ${member.email}`);
  console.log(`  User ID: ${member.user_id}`);
  console.log(`  Role: ${member.role}`);
  console.log(`  Status: ${member.status}${member.enabled ? " / enabled" : " / disabled"}`);
  console.log(`  Auth user: ${created ? "created and email-confirmed" : "existing user reused"}`);

  if (password) {
    console.log(`  Password: ${password}`);
    console.log("  Change this password after the first sign-in. It will not be shown again.");
  } else {
    console.log("  Password: unchanged; use --update-password to rotate an existing password.");
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  console.log(`  Admin URL: ${appUrl ? `${appUrl}/admin` : "/admin"}`);
}

function printUsage() {
  console.log(`Usage: npm run admin:create -- [options]

Creates an email-confirmed Supabase Auth user and grants access through public.admin_members.

Options:
  -e, --email <address>          Admin email. Defaults to ADMIN_BOOTSTRAP_EMAIL.
  -p, --password <value>         Optional password. A strong password is generated when omitted.
  -r, --role <role>              owner, ops, support, finance, reviewer, engineer, viewer. Default: owner.
      --display-name <name>      Display name. Defaults to the email local part.
      --update-password          Rotate the password when the Auth user already exists.
  -h, --help                     Show this help.

Environment:
  NEXT_PUBLIC_SUPABASE_URL       Required Supabase project URL.
  SUPABASE_SERVICE_ROLE_KEY      Required server-only service-role key.
  ADMIN_BOOTSTRAP_EMAIL          Optional email default.
  ADMIN_BOOTSTRAP_PASSWORD       Optional password default.
  ADMIN_BOOTSTRAP_ROLE           Optional role default.
  ADMIN_BOOTSTRAP_DISPLAY_NAME   Optional display-name default.

Examples:
  npm run admin:create -- --email owner@example.com
  ADMIN_BOOTSTRAP_PASSWORD='replace-with-a-strong-password' npm run admin:create -- --email owner@example.com
  npm run admin:create -- --email owner@example.com --role owner --update-password
`);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function parseRole(value: string): AdminRole {
  const normalized = value.trim().toLowerCase();
  if (!ADMIN_ROLES.includes(normalized as AdminRole)) {
    throw new Error(`role must be one of: ${ADMIN_ROLES.join(", ")}`);
  }
  return normalized as AdminRole;
}

function generatePassword() {
  return randomBytes(24).toString("base64url");
}

async function findUserByEmail(admin: UserLookupClient, email: string) {
  let page = 1;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Supabase Auth listUsers failed: ${error.message}`);
    const user = data.users.find((candidate) => normalizeEmail(candidate.email || "") === email);
    if (user) return user;
    if (!data.nextPage) return null;
    page = data.nextPage;
  }
  throw new Error("Supabase Auth user lookup exceeded the pagination limit");
}

function isAlreadyRegisteredError(error: { message?: string; code?: string } | null) {
  const message = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return message.includes("already") || message.includes("registered") || message.includes("exists");
}
