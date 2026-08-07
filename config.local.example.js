/* Copy this to config.local.js and add your own key. config.local.js is
   gitignored: a Google API key in a public repo is a key anyone can spend.

   Free, no card, about two minutes:
     1. console.cloud.google.com -> new project
     2. Enable "PageSpeed Insights API"
     3. Credentials -> Create credentials -> API key
     4. Restrict it to that API, and to your Pages domain

   Optional. Without it, PageSpeed is the only thing you lose. */

window.PULSE_CONFIG = {
  psiKey: ''
};
