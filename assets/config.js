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
   * Local preview escape hatch. While true, report.html?unlocked=1 shows the
   * full report without a payment.
   *
   * It only takes effect on a local hostname, so leaving it on cannot leak a
   * paid report from a published site — but keep it false anyway.
   */
  ALLOW_DEMO_UNLOCK: false,

  /*
   * Whether report.html?sample=… may show the full report.
   *
   * Always available on a local hostname. Set this to true to allow it on a
   * published site too — which means anyone who guesses the query string, and
   * the "Download PDF" button, gets the entire paid report for free. Only do
   * that if you are deliberately publishing a full example.
   */
  ALLOW_SAMPLE_PREVIEW: false,

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
   *   Stripe        -> client_reference_id   (currently selected)
   *   Lemon Squeezy -> checkout[custom][ref]
   *   Paddle        -> (uses _passthrough; see worker/README.md)
   *
   * This must match the parameter name configured in your provider's dashboard.
   * If the two differ the customer is charged, the webhook arrives with no order
   * reference, and the report never unlocks.
   */
  CHECKOUT_REF_PARAM: "client_reference_id",

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
