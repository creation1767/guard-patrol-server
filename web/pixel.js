/* Meta Pixel for 4horsemansecurity.com (public pages only; never on the dashboard, client portal or app). */
!function (f, b, e, v, n, t, s) {
  if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
  t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1142634938462221');
fbq('track', 'PageView');
// Safe helper for page events: never sends names, emails or company details.
window.hmTrack = function (event, params) { try { window.fbq && fbq('track', event, params || {}); } catch (e) { } };
