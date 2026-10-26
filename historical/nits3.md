> **Status: HISTORICAL** (24 Oct 2026). Checklist (29 Sep). One item open: the worker-window button when a window is already open. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

1.  If background worker window exists, hitting preferences dashboard button doesn't bring one up in the current window.

2.  On unpause with no worker window, worker is created and brought to foreground, but not buried behind the user window. 

3.  Change the pause save of flight recorder and event data to follow dev-mode; ordinary users don't need it.

4.  Check up on the button placement bug in 1.4 https://qr.ae/pFJLuz

5.  Preferences revisit.  FOP button delay?   Answers only flip?   Profiles per batch?    Recent history might want to be a page that shows it.  Save Preferences/Reset to Defaults;  Open Dashboard/Open History


6.   Observered behavior, long page load times lead to long blocks.  Argues for pre-load of future tabs.

7.   Pause should be clean and ensure no active.  Wait for drain or cancel/close tabe?

8.  Should separate page open from page load complete time, when we can start to run.  Add page load time average and remove from secs/{real,already}.  A what is handoff measuring?  Think close to open or loaded?  Don't want to count load time against us.





