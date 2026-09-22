/** Apply the configured navigation visibility to the installed widget. */
export function configureIgvNavigation(browser: {
  config: { showMultiSelectButton?: boolean };
  navbar: { multiTrackSelectButton: { setVisibility(visible: boolean): void } };
}) {
  // igv 3.8.5 reads this option but passes it only into hover handling;
  // its constructor never applies the requested visibility. Use the same
  // instance's native visibility API. True/absent retain the library default.
  if (browser.config.showMultiSelectButton === false) {
    browser.navbar.multiTrackSelectButton.setVisibility(false);
  }
}
