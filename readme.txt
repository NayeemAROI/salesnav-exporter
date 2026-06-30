========================================
  SalesNav Exporter (Internal) v0.4.2
  Installation & Usage Guide
========================================


INSTALLATION (Chrome / Edge / Brave)
------------------------------------

1. Open your browser and go to:
   - Chrome:  chrome://extensions
   - Edge:    edge://extensions
   - Brave:   brave://extensions

2. Enable "Developer mode" (toggle in the top-right corner).

3. Click "Load unpacked".

4. Select the "salesnav-exporter" folder (the one containing manifest.json).

5. The extension icon will appear in your browser toolbar.
   Pin it for easy access by clicking the puzzle icon > pin.

6. Done! Navigate to LinkedIn Sales Navigator to start using the extension.


UPDATING THE EXTENSION
----------------------

1. Replace the old "salesnav-exporter" folder with the new one.

2. Go to chrome://extensions (or equivalent).

3. Click the refresh icon on the SalesNav Exporter card,
   or toggle it off and on again.


HOW TO USE
----------

A) LIST EXPORTER (Sales Navigator)
   - Go to a Sales Navigator People search or Lead list.
   - Click the extension icon.
   - Click "Export Current Page" to download a CSV of visible leads.

B) DEEP SCANNER (Profile Activity Checker)
   - Click the extension icon.
   - Paste LinkedIn profile URLs (one per line) into the scanner textarea.
     URLs must contain "linkedin.com/in/" to be accepted.
   - Set filters:
     * Min Connections: skip profiles below this connection count.
     * Activity within X Months: profiles active within this period = "active".
   - Click "Start Scanner".
   - The scanner visits each profile's activity tabs to find the most recent
     activity and determines active/inactive status.
   - Results appear in the preview table and can be downloaded as CSV.


LIMITS
------

- Max 50 profiles per scan session.
- Max 100 profiles per day (resets at midnight).
- Only URLs containing "linkedin.com/in/" are accepted.
  Invalid URLs will be listed and excluded automatically.


CSV OUTPUT COLUMNS
------------------

- Name
- Profile URL
- Status (active / inactive)
- Is Premium? (Yes / No)
- Number of Connections
- Last Activity (e.g., "2 Months", "1 Week", "3 Days")


TROUBLESHOOTING
---------------

- Extension not loading?
  Make sure "Developer mode" is ON and you selected the correct folder.

- Pages timing out?
  The scanner retries with a hard reload automatically. If it still fails,
  check your internet connection and try again.

- Wrong data / blank fields?
  Reload the extension (refresh button on chrome://extensions) and try again.

- "Daily limit reached" error?
  You've scanned 100 profiles today. Try again tomorrow.


IMPORTANT NOTES
---------------

- Use responsibly. Excessive automation may trigger LinkedIn restrictions.
- This extension works only on linkedin.com and requires an active
  Sales Navigator subscription for list export features.
- The Deep Scanner works with regular LinkedIn profile URLs (/in/...).
