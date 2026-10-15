import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Sign-in for the desktop app, using the flows OAuth providers recommend for
// installed apps (no client secret is treated as confidential, no password
// ever touches SwarmCode):
//   GitHub: OAuth device flow - the user enters a short code on github.com.
//   Google: authorization code + PKCE with a loopback redirect to 127.0.0.1.
// Client IDs come from environment variables or ~/.swarmcode/desktop.json, so
// each distributor of SwarmCode registers their own OAuth apps.

export interface Account {
  provider: "github" | "google";
  id: string;
  name: string;
  login?: string;
  email?: string;
  /** data: URL, so the sandboxed UI can show it without loading remote content. */
  avatar?: string;
}

export interface OAuthConfig {
  githubClientId?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

const json = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected response from ${res.url}: ${text.slice(0, 200)}`);
  }
};

async function avatarDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url || !/^https:\/\//.test(url)) return undefined;
  try {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 512_000 ? `data:${type.split(";")[0]};base64,${buf.toString("base64")}` : undefined;
  } catch {
    return undefined;
  }
}

// ---- GitHub device flow ------------------------------------------------------------

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  deviceCode: string;
}

export async function githubStart(clientId: string): Promise<DeviceCode> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "read:user user:email" }),
  });
  const j = await json(res);
  if (!res.ok || !j.device_code) throw new Error(`GitHub sign-in could not start: ${String(j.error_description ?? j.error ?? res.status)}`);
  return {
    deviceCode: String(j.device_code),
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri),
    expiresIn: Number(j.expires_in ?? 900),
    interval: Number(j.interval ?? 5),
  };
}

/** Poll until the user approves (or the code expires / is denied / the signal aborts). */
export async function githubFinish(clientId: string, code: DeviceCode, signal?: AbortSignal): Promise<{ account: Account; token: string }> {
  let interval = code.interval;
  const deadline = Date.now() + code.expiresIn * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Sign-in cancelled.");
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, device_code: code.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    const j = await json(res);
    if (j.access_token) {
      const token = String(j.access_token);
      const user = await json(await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "SwarmCode" } }));
      return {
        token,
        account: {
          provider: "github",
          id: String(user.id),
          login: String(user.login),
          name: String(user.name || user.login),
          email: user.email ? String(user.email) : undefined,
          avatar: await avatarDataUrl(user.avatar_url ? String(user.avatar_url) : undefined),
        },
      };
    }
    if (j.error === "slow_down") interval += 5;
    else if (j.error === "access_denied") throw new Error("Sign-in was denied on GitHub.");
    else if (j.error === "expired_token") break;
    else if (j.error !== "authorization_pending") throw new Error(`GitHub sign-in failed: ${String(j.error_description ?? j.error)}`);
  }
  throw new Error("The GitHub code expired. Try again.");
}

// ---- Google: authorization code + PKCE, loopback redirect ------------------------------

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>SwarmCode</title><body style="background:#000;color:#ededed;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="font-weight:600">You're signed in</h2><p style="color:#8a8a8a">You can close this tab and return to SwarmCode.</p></div>`;

export async function googleSignIn(clientId: string, clientSecret: string | undefined, openBrowser: (url: string) => void, signal?: AbortSignal): Promise<{ account: Account }> {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google sign-in timed out.")), 5 * 60_000);
      signal?.addEventListener("abort", () => reject(new Error("Sign-in cancelled.")));
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/") return void res.writeHead(404).end();
        const err = url.searchParams.get("error");
        const got = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state || (!got && !err)) {
          res.writeHead(400).end("Invalid sign-in response.");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(err ? "<p>Sign-in was cancelled. You can close this tab.</p>" : DONE_PAGE);
        clearTimeout(timer);
        if (err) reject(new Error(`Google sign-in: ${err}`));
        else resolve(got!);
      });
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        prompt: "select_account",
      }).toString();
      openBrowser(auth.toString());
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    const tokens = await json(tokenRes);
    if (!tokenRes.ok || !tokens.access_token) throw new Error(`Google sign-in failed: ${String(tokens.error_description ?? tokens.error ?? tokenRes.status)}`);
    const user = await json(await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    return {
      account: {
        provider: "google",
        id: String(user.sub),
        name: String(user.name || user.email),
        email: user.email ? String(user.email) : undefined,
        avatar: await avatarDataUrl(user.picture ? String(user.picture) : undefined),
      },
    };
  } finally {
    server.close();
  }
}
