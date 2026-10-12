/*
 * FocusCheck — public configuration
 *
 * This file is served to the browser, so nothing secret belongs here.
 * The LLM API key and the payment webhook secret live only in the Worker.
 */
window.FOCUSCHECK_CONFIG = {

  /* ---------------------------------------------------------------- *
   * Report generation
   * ---------------------------------------------------------------- */

  /*
   * URL of your deployed Worker (see worker/README.md).
   *
   * Leave empty to disable AI generation — the site then falls back to the
   * built-in template report, which still works.
   *
   * Example: "https://focuscheck-report.your-subdomain.workers.dev"
   */
  API_ENDPOINT: "",

  /* How long to wait for generation before falling back, in milliseconds. */
  TIMEOUT_MS: 45000,

  /*
   * While true, report.html?unlocked=1 grants access for testing.
   * Set to false in production.
   */
  ALLOW_DEMO_UNLOCK: true,

  /* ---------------------------------------------------------------- *
   * Payment
   * ---------------------------------------------------------------- */

  /*
   * Your hosted checkout link.
   *
   * Lemon Squeezy: Settings -> Checkout -> copy the buy link
   * Paddle:        Catalogue -> product -> copy the checkout link
   * Stripe:        Payment Links -> copy the link
   *
   * Leave empty and the Unlock button just shows setup instructions.
   */
  CHECKOUT_URL: "",

  /*
   * The query parameter your provider uses for custom data, so the order can be
   * matched to this browser after payment.
   *
   *   Lemon Squeezy -> checkout[custom][ref]
   *   Paddle        -> (uses _passthrough; see worker/README.md)
   *   Stripe        -> client_reference_id
   */
  CHECKOUT_REF_PARAM: "checkout[custom][ref]",

  /* Where the provider should send the customer after a successful payment. */
  RETURN_URL: "report.html",

  /* ---------------------------------------------------------------- *
   * Sharing
   * ---------------------------------------------------------------- */

  /*
   * The public address of the site, used on the share card and in share links.
   *
   * Leave empty and it is derived from the current page URL, which is correct
   * for GitHub Pages and most static hosts. Set it explicitly if the site is
   * served from a sub-path or behind a custom domain.
   */
  SITE_URL: ""
};
