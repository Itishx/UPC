// Braino chat widget.
// The site_id is public by design — access is gated by allowed_origins on
// Braino's side. Nothing loads until VITE_BRAINO_SITE_ID is set, so the site
// works fine before the account owner provisions one.

const siteId = import.meta.env.VITE_BRAINO_SITE_ID;

if (siteId) {
  const script = document.createElement('script');
  script.src = 'https://trybraino.com/embed/braino-embed.js';
  script.setAttribute('data-braino-site', siteId);
  script.async = true;
  document.head.appendChild(script);
}
