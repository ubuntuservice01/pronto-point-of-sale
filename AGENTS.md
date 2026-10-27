<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project rules
- Self-service onboarding shows its success screen only after `confirmSelfServiceActivation` reads back the owner grant and a live 10-day trial; an RPC "ok" alone is never proof, so retries cannot announce or create a duplicate shop.
- Once signup has produced a session, the registration form switches to activation-only (no second signup); details are kept in memory only, never in storage.
