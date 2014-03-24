(function ($) {
  'use strict';
  $.extend( true, window, {
    tabMan: {
      parseURL: parseURL,
      syncWindowList: syncWindowList,
      manageWindow: manageWindow,
      unmanageWindow: unmanageWindow,
    }
  });

  var windowIdMap = {};
  var tabWindows = [];


  var tabmanFolderId = null;
  var tabmanFolderTitle = "Subjective Tab Manager";

  var archiveFolderId = null;
  var archiveFolderTitle = "_Archive";


 /*
  * begin managing the specified tab window
  */
  function manageWindow( tabWindow, opts ) {
    tabWindow._managed = true;
    tabWindow._managedTitle = opts.title;

    // and write out a Bookmarks folder for this newly managed window:
    if( !tabmanFolderId ) {
      alert( "Could not save bookmarks -- no tab manager folder" );
    }
    var windowFolder = { parentId: tabmanFolderId,
                         title: tabWindow._managedTitle,
                       };
    chrome.bookmarks.create( windowFolder, function( windowFolderNode ) {
      console.log( "succesfully created bookmarks folder ", windowFolderNode );
      console.log( "for window: ", tabWindow );
      var tabs = tabWindow.chromeWindow.tabs;
      for( var i = 0; i < tabs.length; i++ ) {
        var tab = tabs[ i ];
        // bookmark for this tab:
        var tabMark = { parentId: windowFolderNode.id, title: tab.title, url: tab.url };
        chrome.bookmarks.create( tabMark, function( tabNode ) {
          console.log( "succesfully bookmarked tab ", tabNode );
        });
      }
      tabWindow.bookmarkFolder = windowFolderNode;
    } );
  }

  /* stop managing the specified window...move all bookmarks for this managed window to Recycle Bin */
  function unmanageWindow( tabWindow ) {
    tabWindow._managed = false;

    if( !archiveFolderId ) {
      alert( "could not move managed window folder to archive -- no archive folder" );
      return;
    }
    chrome.bookmarks.move( tabWindow.bookmarkFolderId, { parentId: archiveFolderId } );
    tabWindow.bookmarkFolder = null;  // disconnect from this bookmark folder
  }

  var tabWindowPrototype = { 
    _managed: false, 
    _managedTitle: "",
    chromeWindow: null,
    bookmarkFolder: null,  
    open: false,
  
    getTitle:  function() {
      if( this._managed ) {
        return this.bookmarkFolder.title;
      } else {
        var tabs = this.chromeWindow.tabs;
        // linear search to find active tab to use as window title
        for ( var j = 0; j < tabs.length; j++ ) {
          var tab = tabs[j];
          if ( tab.active ) {
            return tab.title;
          }
        }
      }
      return "";  // shouldn't happen
    },
  
    isManaged: function() {
      return this._managed;
    },

    // Get a set of tab-like items for rendering
    getTabItems: function() {
      var tabs;
      if( this.open ) {
        tabs = this.chromeWindow.tabs;
      } else {
        tabs = this.bookmarkFolder.children;
      }
      return tabs;
    }
  };

  /*  
   * initialize a tab window from a (unmanaged) chrome Window
   */
  function makeChromeTabWindow( chromeWindow ) {
    var ret = Object.create( tabWindowPrototype );
    ret.chromeWindow = chromeWindow;
    ret.open = true;
    return ret;
  }

  /*
   * initialize an unopened window from a bookmarks folder
   */
  function makeFolderTabWindow( bookmarkFolder ) {
    var ret = Object.create( tabWindowPrototype );
    ret._managed = true;
    ret.bookmarkFolder = bookmarkFolder;

    return ret;
  }

   /*
    * add a new Tab window to global maps:
    */
   function addTabWindow( tabWindow ) {
      var chromeWindow = tabWindow.chromeWindow;
      if( chromeWindow ) {
        windowIdMap[ chromeWindow.id ] = tabWindow;
      }
      tabWindows.push( tabWindow );     
   }

  /**
   * synchronize windows from chrome.windows.getAll with internal map of
   * managed and unmanaged tab windows
   * returns:
   *   - array of all tab Windows
   */
  function syncWindowList( chromeWindowList ) {
    // To GC any closed windows:
    for ( var i = 0; i < tabWindows.length; i++ ) {
      var tabWindow = tabWindows[ i ];
      if( tabWindow )
        tabWindow.open = false;
    }
    for ( var i = 0; i < chromeWindowList.length; i++ ) {
      var chromeWindow = chromeWindowList[ i ];
      var tabWindow = windowIdMap[ chromeWindow.id ];
      if( !tabWindow ) {
        console.log( "syncWindowList: new window id: ", chromeWindow.id );
        tabWindow = makeChromeTabWindow( chromeWindow );
        addTabWindow( tabWindow );
      } else {
        console.log( "syncWindowList: cache hit for id: ", chromeWindow.id );
        // Set chromeWindow to current snapshot of tab contents:
        tabWindow.chromeWindow = chromeWindow;
        tabWindow.open = true;
      }
    }
    // GC any closed, unmanaged windows:
    for ( var i = 0; i < tabWindows.length; i++ ) {
      tabWindow = tabWindows[ i ];
      if( tabWindow && !( tabWindow._managed ) && !( tabWindow.open ) ) {
        console.log( "syncWindowList: detected closed window id: ", tabWindow.chromeWindow.id );
        delete windowIdMap[ tabWindow.chromeWindow.id ];
        delete tabWindows[ i ];
      }
    }

    return tabWindows;
  }   

  /* On startup load managed windows from bookmarks folder */
  function loadManagedWindows( tabManFolder ) {
    function loadWindow( winFolder ) {
      var folderWindow = makeFolderTabWindow( winFolder );
      addTabWindow( folderWindow );
    }

    for( var i = 0; i < tabManFolder.children.length; i++ ) {
      var windowFolder = tabManFolder.children[ i ];
      if( windowFolder.title[0] === "_" ) {
        continue;
      }
      loadWindow( windowFolder );
    }
  }


  // This function creates a new anchor element and uses location
  // properties (inherent) to get the desired URL data. Some String
  // operations are used (to normalize results across browsers).
  // From http://james.padolsey.com/javascript/parsing-urls-with-the-dom/ 
  function parseURL(url) {
      var a =  document.createElement('a');
      a.href = url;
      return {
          source: url,
          protocol: a.protocol.replace(':',''),
          host: a.hostname,
          port: a.port,
          query: a.search,
          params: (function(){
              var ret = {},
                  seg = a.search.replace(/^\?/,'').split('&'),
                  len = seg.length, i = 0, s;
              for (;i<len;i++) {
                  if (!seg[i]) { continue; }
                  s = seg[i].split('=');
                  ret[s[0]] = s[1];
              }
              return ret;
          })(),
          file: (a.pathname.match(/\/([^\/?#]+)$/i) || [,''])[1],
          hash: a.hash.replace('#',''),
          path: a.pathname.replace(/^([^\/])/,'/$1'),
          relative: (a.href.match(/tps?:\/\/[^\/]+(.+)/) || [,''])[1],
          segments: a.pathname.replace(/^\//,'').split('/')
      };
  }

  /*
   * given a specific parent Folder node, ensure a particular child exists.
   * Will invoke callback either synchronously or asynchronously passing the node
   * for the named child
   */
  function ensureChildFolder( parentNode, childFolderName, callback ) {
    for ( var i = 0; i < parentNode.children.length; i++ ) {
      var childFolder = parentNode.children[ i ];
      if( childFolder.title.toLowerCase() === childFolderName.toLowerCase() ) {
        // exists
        console.log( "found target child folder: ", childFolderName );
        callback( childFolder );
        return true;
      }
    }
    console.log( "Child folder ", childFolderName, " Not found, creating..." );
    // If we got here, child Folder doesn't exist
    var folderObj = { parentId: parentNode.id, title: childFolderName };
    chrome.bookmarks.create( folderObj, callback );
  }

  function initBookmarks() {
    chrome.bookmarks.getTree(function(tree){
      var otherBookmarksNode = tree[0].children[1]; 
      console.log( "otherBookmarksNode: ", otherBookmarksNode );
      ensureChildFolder( otherBookmarksNode, tabmanFolderTitle, function( tabManFolder ) {
        console.log( "tab manager folder acquired." );
        tabmanFolderId = tabManFolder.id;
        ensureChildFolder( tabManFolder, archiveFolderTitle, function( archiveFolder ) {
          console.log( "archive folder acquired." );
          archiveFolderId = archiveFolder.id;
          loadManagedWindows( tabManFolder );
        })
      });
    });
  }

  initBookmarks();

})(jQuery);
