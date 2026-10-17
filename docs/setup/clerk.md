# Setting up Clerk for Clew

Clew uses [Clerk](https://clerk.com) for sign-in, so Clew never stores a password. The owner does these steps once in the Clerk dashboard. Keys go in environment variables or GitHub Actions secrets. Never put them in code, issues or chat.

## 1. Create the application

1. Sign up at clerk.com and create an application named **Clew**. That gives you a free **Development** instance.
2. Under **User & authentication**, turn on:
   - **Email**, with the **Email verification code** (or email link) sign-in method
   - **Passkeys**
   - **Google** and **LinkedIn (OIDC)** under social connections. The development instance uses Clerk's shared test credentials, so no Google or LinkedIn setup is needed yet.
3. Turn **Password** off. Clew signs people in with passkeys, social sign-in and email codes only.
4. Leave Clerk's default account linking as is. It links a social sign-in to an existing account only when the provider has verified the email (threat model R4).

## 2. Put the email address in the session token

The API creates the Clew account from the session token, so the token needs the user's email.

**Sessions → Customize session token**, paste this and save:

```json
{
  "email": "{{user.primary_email_address}}"
}
```

## 3. Copy two values

From **Configure → API keys**:

| Clerk value | Looks like | Where it goes |
| --- | --- | --- |
| Publishable key | `pk_test_…` | `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local` (and the web app's host later) |
| Frontend API URL | `https://<name>.clerk.accounts.dev` | `CLEW_CLERK_ISSUER` in `backend/.env` (and the API's host later) |

The publishable key is designed to be public, since it ships in the web app, but it still lives in env files rather than code.

The **Secret key** (`sk_test_…`) isn't needed by Clew yet. QA's end-to-end tests will need it later as a GitHub Actions secret named `CLERK_SECRET_KEY`. Add it under **Settings → Secrets and variables → Actions** when QA asks, and nowhere else.

## 4. Before launch (production instance)

- Create the **Production** instance, add the clewapply.com domain, and set up your own Google and LinkedIn OAuth apps.
- Set `CLEW_CLERK_ISSUER` to the production Frontend API URL, and list the production web origin in `CLEW_CORS_ORIGINS`. The API only accepts tokens minted for those origins.
