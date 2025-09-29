// Static dev config: use relative paths so the CLI app proxy handles the origin.
(function(){
  window.BUNDLE_APP_CONFIG = {
    tunnelUrl: '',
    apiBase: '/apps'
  };
})();
