Here are some housekeeping things I'd like done as some point.

1.  Split sw.js into more pieces

    - swstorage.js  to encapsulate the Storage abtraction and to 
      contain knowledge/visibility of "WAL"
      
    - swdashboard.js to encapsulate the dashboard.
    
    - swprefs.js for the preferences panel

    2026-06-27 slice:

    - `shared/js/swstorage.js` now owns the service-worker storage visibility
      boundary and re-exports WAL/checkpoint implementation details.
    - `shared/js/swdashboard.js` now owns dashboard read-model storage keys.
    - `shared/js/swprefs.js` now owns coordinator preference/control keys.
    - `shared/js/sw.js` imports those visibility boundaries instead of
      defining those pieces inline.
    
2.  I'd like architectural comments in the base source code that can be 
    stripped out of the production builds.

    2026-06-27 slice:

    - Added `ARCHITECTURE:` source comments to the new boundary modules.
    - Added a production-only webpack plugin that strips `ARCHITECTURE:`
      block comments from generated JavaScript assets.

3.  Split the flight recorder out of `sw.js`.

    2026-06-27 slice:

    - `shared/js/swflightRecorder.js` now owns volatile flight-recorder state,
      event sanitization, append, snapshot, and read-only response helpers.
    - `shared/js/sw.js` records and reads diagnostics through that boundary.
    - The recorder remains storage-free and scheduler-free; it observes
      transitions but does not affect authority.
    
