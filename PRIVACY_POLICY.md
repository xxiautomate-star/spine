# Spine — Privacy Policy

*Effective: 20 April 2026 · Owner: XXIautomate (Roman Puglielli, ABN 46248687420)*

---

## What Spine is

Spine is a browser extension and MCP server that captures facts from your AI conversations and makes them available to your AI in future sessions. Think of it as a personal memory archive — yours alone.

---

## What we collect

### From the browser extension

When you use Spine on a supported site (ChatGPT, Gemini), the extension reads:

| Data | Why |
|---|---|
| **Page URL** | To identify which AI service generated the memory |
| **Page title** | To label the memory source in your archive |
| **Selected text** (if you manually trigger capture) | The content you chose to remember |
| **Conversation excerpts** | Facts extracted from the current chat session |

We do **not** collect:
- Your full conversation history
- Passwords, payment details, or form data
- Browsing history outside of chatgpt.com and gemini.google.com
- Any data from sites you haven't explicitly enabled in settings

### From the MCP server

When you use the Spine MCP tools (`spine_remember`, `spine_recall`, `spine_forget`) inside Claude Code or Claude Desktop:

| Data | Why |
|---|---|
| **Memory content you submit** | The fact you asked Spine to store |
| **Recall queries** | To retrieve relevant memories; not stored separately |

---

## How we store it

Everything is stored in **your personal Supabase database row**, keyed to your account. Row-level security ensures no other user can read your data.

- Extension state (queue, settings) lives in `chrome.storage.local` and `chrome.storage.sync` — **your browser, no third party**.
- Memories synced to the server are stored in Supabase Postgres (Sydney region) with vector embeddings for semantic search.
- We do not sell, license, or share your memory data with any third party.
- We do not use your memories to train models.

---

## Third-party services used

| Service | Purpose | Their privacy policy |
|---|---|---|
| **Supabase** | Database, auth | [supabase.com/privacy](https://supabase.com/privacy) |
| **OpenAI** | Generating embeddings for semantic search | [openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy) |
| **Stripe** | Payment processing (Pro plan) | [stripe.com/privacy](https://stripe.com/privacy) |

OpenAI receives your memory *content* to produce a vector embedding. Their data retention policy (zero-day retention on the Embeddings API) means they do not store it.

We use no advertising networks, analytics SDKs, or tracking pixels.

---

## Retention and deletion

- You can delete any individual memory from your dashboard at any time.
- You can delete your entire account and all associated data from Settings → Account → Delete account.
- Deletion is permanent. We do not retain backups of deleted memories.
- Stripe retains billing records as required by payment regulations; we have no control over that.

---

## Permissions the extension requests

| Permission | Why we need it |
|---|---|
| `storage` | Save your settings and memory queue locally in Chrome |
| `activeTab` | Read the current page's URL and title when you trigger a capture |
| `host_permissions: chatgpt.com, gemini.google.com` | Read conversation content on the AI sites you enable |
| `host_permissions: spine.xxiautomate.com` | Sync your queue to the Spine API |

We do not request access to all URLs. The extension only operates on the sites listed above.

---

## Children

Spine is not directed at children under 13. We do not knowingly collect data from anyone under 13.

---

## Changes

If we materially change what we collect or how we use it, we will update this policy and notify you via the dashboard. Continued use after the notice period constitutes acceptance.

---

## Contact

Questions? Email **rsautomateads@gmail.com** or open an issue at **github.com/xxiautomate-star/spine**.
