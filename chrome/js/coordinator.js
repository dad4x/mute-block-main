/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/webextension-polyfill/dist/browser-polyfill.js":
/*!*********************************************************************!*\
  !*** ./node_modules/webextension-polyfill/dist/browser-polyfill.js ***!
  \*********************************************************************/
/***/ (function(module, exports) {

var __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;(function (global, factory) {
  if (true) {
    !(__WEBPACK_AMD_DEFINE_ARRAY__ = [module], __WEBPACK_AMD_DEFINE_FACTORY__ = (factory),
		__WEBPACK_AMD_DEFINE_RESULT__ = (typeof __WEBPACK_AMD_DEFINE_FACTORY__ === 'function' ?
		(__WEBPACK_AMD_DEFINE_FACTORY__.apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__)) : __WEBPACK_AMD_DEFINE_FACTORY__),
		__WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
  } else { var mod; }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (module) {
  /* webextension-polyfill - v0.12.0 - Tue May 14 2024 18:01:29 */
  /* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */
  /* vim: set sts=2 sw=2 et tw=80: */
  /* This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
  "use strict";

  if (!(globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id)) {
    throw new Error("This script should only be loaded in a browser extension.");
  }
  if (!(globalThis.browser && globalThis.browser.runtime && globalThis.browser.runtime.id)) {
    const CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE = "The message port closed before a response was received.";

    // Wrapping the bulk of this polyfill in a one-time-use function is a minor
    // optimization for Firefox. Since Spidermonkey does not fully parse the
    // contents of a function until the first time it's called, and since it will
    // never actually need to be called, this allows the polyfill to be included
    // in Firefox nearly for free.
    const wrapAPIs = extensionAPIs => {
      // NOTE: apiMetadata is associated to the content of the api-metadata.json file
      // at build time by replacing the following "include" with the content of the
      // JSON file.
      const apiMetadata = {
        "alarms": {
          "clear": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "clearAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "get": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "bookmarks": {
          "create": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getChildren": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getRecent": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getSubTree": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTree": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "move": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeTree": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "browserAction": {
          "disable": {
            "minArgs": 0,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "enable": {
            "minArgs": 0,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "getBadgeBackgroundColor": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getBadgeText": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getPopup": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTitle": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "openPopup": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "setBadgeBackgroundColor": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setBadgeText": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setIcon": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "setPopup": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setTitle": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "browsingData": {
          "remove": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "removeCache": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeCookies": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeDownloads": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeFormData": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeHistory": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeLocalStorage": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removePasswords": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removePluginData": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "settings": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "commands": {
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "contextMenus": {
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "cookies": {
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAllCookieStores": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "set": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "devtools": {
          "inspectedWindow": {
            "eval": {
              "minArgs": 1,
              "maxArgs": 2,
              "singleCallbackArg": false
            }
          },
          "panels": {
            "create": {
              "minArgs": 3,
              "maxArgs": 3,
              "singleCallbackArg": true
            },
            "elements": {
              "createSidebarPane": {
                "minArgs": 1,
                "maxArgs": 1
              }
            }
          }
        },
        "downloads": {
          "cancel": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "download": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "erase": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getFileIcon": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "open": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "pause": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeFile": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "resume": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "show": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "extension": {
          "isAllowedFileSchemeAccess": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "isAllowedIncognitoAccess": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "history": {
          "addUrl": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "deleteAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "deleteRange": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "deleteUrl": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getVisits": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "search": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "i18n": {
          "detectLanguage": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAcceptLanguages": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "identity": {
          "launchWebAuthFlow": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "idle": {
          "queryState": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "management": {
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getSelf": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "setEnabled": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "uninstallSelf": {
            "minArgs": 0,
            "maxArgs": 1
          }
        },
        "notifications": {
          "clear": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "create": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getPermissionLevel": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        },
        "pageAction": {
          "getPopup": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getTitle": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "hide": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setIcon": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "setPopup": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "setTitle": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          },
          "show": {
            "minArgs": 1,
            "maxArgs": 1,
            "fallbackToNoCallback": true
          }
        },
        "permissions": {
          "contains": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "request": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "runtime": {
          "getBackgroundPage": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getPlatformInfo": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "openOptionsPage": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "requestUpdateCheck": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "sendMessage": {
            "minArgs": 1,
            "maxArgs": 3
          },
          "sendNativeMessage": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "setUninstallURL": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "sessions": {
          "getDevices": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getRecentlyClosed": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "restore": {
            "minArgs": 0,
            "maxArgs": 1
          }
        },
        "storage": {
          "local": {
            "clear": {
              "minArgs": 0,
              "maxArgs": 0
            },
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "remove": {
              "minArgs": 1,
              "maxArgs": 1
            },
            "set": {
              "minArgs": 1,
              "maxArgs": 1
            }
          },
          "managed": {
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            }
          },
          "sync": {
            "clear": {
              "minArgs": 0,
              "maxArgs": 0
            },
            "get": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "getBytesInUse": {
              "minArgs": 0,
              "maxArgs": 1
            },
            "remove": {
              "minArgs": 1,
              "maxArgs": 1
            },
            "set": {
              "minArgs": 1,
              "maxArgs": 1
            }
          }
        },
        "tabs": {
          "captureVisibleTab": {
            "minArgs": 0,
            "maxArgs": 2
          },
          "create": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "detectLanguage": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "discard": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "duplicate": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "executeScript": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getCurrent": {
            "minArgs": 0,
            "maxArgs": 0
          },
          "getZoom": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getZoomSettings": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "goBack": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "goForward": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "highlight": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "insertCSS": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "move": {
            "minArgs": 2,
            "maxArgs": 2
          },
          "query": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "reload": {
            "minArgs": 0,
            "maxArgs": 2
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "removeCSS": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "sendMessage": {
            "minArgs": 2,
            "maxArgs": 3
          },
          "setZoom": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "setZoomSettings": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "update": {
            "minArgs": 1,
            "maxArgs": 2
          }
        },
        "topSites": {
          "get": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "webNavigation": {
          "getAllFrames": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "getFrame": {
            "minArgs": 1,
            "maxArgs": 1
          }
        },
        "webRequest": {
          "handlerBehaviorChanged": {
            "minArgs": 0,
            "maxArgs": 0
          }
        },
        "windows": {
          "create": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "get": {
            "minArgs": 1,
            "maxArgs": 2
          },
          "getAll": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getCurrent": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "getLastFocused": {
            "minArgs": 0,
            "maxArgs": 1
          },
          "remove": {
            "minArgs": 1,
            "maxArgs": 1
          },
          "update": {
            "minArgs": 2,
            "maxArgs": 2
          }
        }
      };
      if (Object.keys(apiMetadata).length === 0) {
        throw new Error("api-metadata.json has not been included in browser-polyfill");
      }

      /**
       * A WeakMap subclass which creates and stores a value for any key which does
       * not exist when accessed, but behaves exactly as an ordinary WeakMap
       * otherwise.
       *
       * @param {function} createItem
       *        A function which will be called in order to create the value for any
       *        key which does not exist, the first time it is accessed. The
       *        function receives, as its only argument, the key being created.
       */
      class DefaultWeakMap extends WeakMap {
        constructor(createItem, items = undefined) {
          super(items);
          this.createItem = createItem;
        }
        get(key) {
          if (!this.has(key)) {
            this.set(key, this.createItem(key));
          }
          return super.get(key);
        }
      }

      /**
       * Returns true if the given object is an object with a `then` method, and can
       * therefore be assumed to behave as a Promise.
       *
       * @param {*} value The value to test.
       * @returns {boolean} True if the value is thenable.
       */
      const isThenable = value => {
        return value && typeof value === "object" && typeof value.then === "function";
      };

      /**
       * Creates and returns a function which, when called, will resolve or reject
       * the given promise based on how it is called:
       *
       * - If, when called, `chrome.runtime.lastError` contains a non-null object,
       *   the promise is rejected with that value.
       * - If the function is called with exactly one argument, the promise is
       *   resolved to that value.
       * - Otherwise, the promise is resolved to an array containing all of the
       *   function's arguments.
       *
       * @param {object} promise
       *        An object containing the resolution and rejection functions of a
       *        promise.
       * @param {function} promise.resolve
       *        The promise's resolution function.
       * @param {function} promise.reject
       *        The promise's rejection function.
       * @param {object} metadata
       *        Metadata about the wrapped method which has created the callback.
       * @param {boolean} metadata.singleCallbackArg
       *        Whether or not the promise is resolved with only the first
       *        argument of the callback, alternatively an array of all the
       *        callback arguments is resolved. By default, if the callback
       *        function is invoked with only a single argument, that will be
       *        resolved to the promise, while all arguments will be resolved as
       *        an array if multiple are given.
       *
       * @returns {function}
       *        The generated callback function.
       */
      const makeCallback = (promise, metadata) => {
        return (...callbackArgs) => {
          if (extensionAPIs.runtime.lastError) {
            promise.reject(new Error(extensionAPIs.runtime.lastError.message));
          } else if (metadata.singleCallbackArg || callbackArgs.length <= 1 && metadata.singleCallbackArg !== false) {
            promise.resolve(callbackArgs[0]);
          } else {
            promise.resolve(callbackArgs);
          }
        };
      };
      const pluralizeArguments = numArgs => numArgs == 1 ? "argument" : "arguments";

      /**
       * Creates a wrapper function for a method with the given name and metadata.
       *
       * @param {string} name
       *        The name of the method which is being wrapped.
       * @param {object} metadata
       *        Metadata about the method being wrapped.
       * @param {integer} metadata.minArgs
       *        The minimum number of arguments which must be passed to the
       *        function. If called with fewer than this number of arguments, the
       *        wrapper will raise an exception.
       * @param {integer} metadata.maxArgs
       *        The maximum number of arguments which may be passed to the
       *        function. If called with more than this number of arguments, the
       *        wrapper will raise an exception.
       * @param {boolean} metadata.singleCallbackArg
       *        Whether or not the promise is resolved with only the first
       *        argument of the callback, alternatively an array of all the
       *        callback arguments is resolved. By default, if the callback
       *        function is invoked with only a single argument, that will be
       *        resolved to the promise, while all arguments will be resolved as
       *        an array if multiple are given.
       *
       * @returns {function(object, ...*)}
       *       The generated wrapper function.
       */
      const wrapAsyncFunction = (name, metadata) => {
        return function asyncFunctionWrapper(target, ...args) {
          if (args.length < metadata.minArgs) {
            throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
          }
          if (args.length > metadata.maxArgs) {
            throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
          }
          return new Promise((resolve, reject) => {
            if (metadata.fallbackToNoCallback) {
              // This API method has currently no callback on Chrome, but it return a promise on Firefox,
              // and so the polyfill will try to call it with a callback first, and it will fallback
              // to not passing the callback if the first call fails.
              try {
                target[name](...args, makeCallback({
                  resolve,
                  reject
                }, metadata));
              } catch (cbError) {
                console.warn(`${name} API method doesn't seem to support the callback parameter, ` + "falling back to call it without a callback: ", cbError);
                target[name](...args);

                // Update the API method metadata, so that the next API calls will not try to
                // use the unsupported callback anymore.
                metadata.fallbackToNoCallback = false;
                metadata.noCallback = true;
                resolve();
              }
            } else if (metadata.noCallback) {
              target[name](...args);
              resolve();
            } else {
              target[name](...args, makeCallback({
                resolve,
                reject
              }, metadata));
            }
          });
        };
      };

      /**
       * Wraps an existing method of the target object, so that calls to it are
       * intercepted by the given wrapper function. The wrapper function receives,
       * as its first argument, the original `target` object, followed by each of
       * the arguments passed to the original method.
       *
       * @param {object} target
       *        The original target object that the wrapped method belongs to.
       * @param {function} method
       *        The method being wrapped. This is used as the target of the Proxy
       *        object which is created to wrap the method.
       * @param {function} wrapper
       *        The wrapper function which is called in place of a direct invocation
       *        of the wrapped method.
       *
       * @returns {Proxy<function>}
       *        A Proxy object for the given method, which invokes the given wrapper
       *        method in its place.
       */
      const wrapMethod = (target, method, wrapper) => {
        return new Proxy(method, {
          apply(targetMethod, thisObj, args) {
            return wrapper.call(thisObj, target, ...args);
          }
        });
      };
      let hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);

      /**
       * Wraps an object in a Proxy which intercepts and wraps certain methods
       * based on the given `wrappers` and `metadata` objects.
       *
       * @param {object} target
       *        The target object to wrap.
       *
       * @param {object} [wrappers = {}]
       *        An object tree containing wrapper functions for special cases. Any
       *        function present in this object tree is called in place of the
       *        method in the same location in the `target` object tree. These
       *        wrapper methods are invoked as described in {@see wrapMethod}.
       *
       * @param {object} [metadata = {}]
       *        An object tree containing metadata used to automatically generate
       *        Promise-based wrapper functions for asynchronous. Any function in
       *        the `target` object tree which has a corresponding metadata object
       *        in the same location in the `metadata` tree is replaced with an
       *        automatically-generated wrapper function, as described in
       *        {@see wrapAsyncFunction}
       *
       * @returns {Proxy<object>}
       */
      const wrapObject = (target, wrappers = {}, metadata = {}) => {
        let cache = Object.create(null);
        let handlers = {
          has(proxyTarget, prop) {
            return prop in target || prop in cache;
          },
          get(proxyTarget, prop, receiver) {
            if (prop in cache) {
              return cache[prop];
            }
            if (!(prop in target)) {
              return undefined;
            }
            let value = target[prop];
            if (typeof value === "function") {
              // This is a method on the underlying object. Check if we need to do
              // any wrapping.

              if (typeof wrappers[prop] === "function") {
                // We have a special-case wrapper for this method.
                value = wrapMethod(target, target[prop], wrappers[prop]);
              } else if (hasOwnProperty(metadata, prop)) {
                // This is an async method that we have metadata for. Create a
                // Promise wrapper for it.
                let wrapper = wrapAsyncFunction(prop, metadata[prop]);
                value = wrapMethod(target, target[prop], wrapper);
              } else {
                // This is a method that we don't know or care about. Return the
                // original method, bound to the underlying object.
                value = value.bind(target);
              }
            } else if (typeof value === "object" && value !== null && (hasOwnProperty(wrappers, prop) || hasOwnProperty(metadata, prop))) {
              // This is an object that we need to do some wrapping for the children
              // of. Create a sub-object wrapper for it with the appropriate child
              // metadata.
              value = wrapObject(value, wrappers[prop], metadata[prop]);
            } else if (hasOwnProperty(metadata, "*")) {
              // Wrap all properties in * namespace.
              value = wrapObject(value, wrappers[prop], metadata["*"]);
            } else {
              // We don't need to do any wrapping for this property,
              // so just forward all access to the underlying object.
              Object.defineProperty(cache, prop, {
                configurable: true,
                enumerable: true,
                get() {
                  return target[prop];
                },
                set(value) {
                  target[prop] = value;
                }
              });
              return value;
            }
            cache[prop] = value;
            return value;
          },
          set(proxyTarget, prop, value, receiver) {
            if (prop in cache) {
              cache[prop] = value;
            } else {
              target[prop] = value;
            }
            return true;
          },
          defineProperty(proxyTarget, prop, desc) {
            return Reflect.defineProperty(cache, prop, desc);
          },
          deleteProperty(proxyTarget, prop) {
            return Reflect.deleteProperty(cache, prop);
          }
        };

        // Per contract of the Proxy API, the "get" proxy handler must return the
        // original value of the target if that value is declared read-only and
        // non-configurable. For this reason, we create an object with the
        // prototype set to `target` instead of using `target` directly.
        // Otherwise we cannot return a custom object for APIs that
        // are declared read-only and non-configurable, such as `chrome.devtools`.
        //
        // The proxy handlers themselves will still use the original `target`
        // instead of the `proxyTarget`, so that the methods and properties are
        // dereferenced via the original targets.
        let proxyTarget = Object.create(target);
        return new Proxy(proxyTarget, handlers);
      };

      /**
       * Creates a set of wrapper functions for an event object, which handles
       * wrapping of listener functions that those messages are passed.
       *
       * A single wrapper is created for each listener function, and stored in a
       * map. Subsequent calls to `addListener`, `hasListener`, or `removeListener`
       * retrieve the original wrapper, so that  attempts to remove a
       * previously-added listener work as expected.
       *
       * @param {DefaultWeakMap<function, function>} wrapperMap
       *        A DefaultWeakMap object which will create the appropriate wrapper
       *        for a given listener function when one does not exist, and retrieve
       *        an existing one when it does.
       *
       * @returns {object}
       */
      const wrapEvent = wrapperMap => ({
        addListener(target, listener, ...args) {
          target.addListener(wrapperMap.get(listener), ...args);
        },
        hasListener(target, listener) {
          return target.hasListener(wrapperMap.get(listener));
        },
        removeListener(target, listener) {
          target.removeListener(wrapperMap.get(listener));
        }
      });
      const onRequestFinishedWrappers = new DefaultWeakMap(listener => {
        if (typeof listener !== "function") {
          return listener;
        }

        /**
         * Wraps an onRequestFinished listener function so that it will return a
         * `getContent()` property which returns a `Promise` rather than using a
         * callback API.
         *
         * @param {object} req
         *        The HAR entry object representing the network request.
         */
        return function onRequestFinished(req) {
          const wrappedReq = wrapObject(req, {} /* wrappers */, {
            getContent: {
              minArgs: 0,
              maxArgs: 0
            }
          });
          listener(wrappedReq);
        };
      });
      const onMessageWrappers = new DefaultWeakMap(listener => {
        if (typeof listener !== "function") {
          return listener;
        }

        /**
         * Wraps a message listener function so that it may send responses based on
         * its return value, rather than by returning a sentinel value and calling a
         * callback. If the listener function returns a Promise, the response is
         * sent when the promise either resolves or rejects.
         *
         * @param {*} message
         *        The message sent by the other end of the channel.
         * @param {object} sender
         *        Details about the sender of the message.
         * @param {function(*)} sendResponse
         *        A callback which, when called with an arbitrary argument, sends
         *        that value as a response.
         * @returns {boolean}
         *        True if the wrapped listener returned a Promise, which will later
         *        yield a response. False otherwise.
         */
        return function onMessage(message, sender, sendResponse) {
          let didCallSendResponse = false;
          let wrappedSendResponse;
          let sendResponsePromise = new Promise(resolve => {
            wrappedSendResponse = function (response) {
              didCallSendResponse = true;
              resolve(response);
            };
          });
          let result;
          try {
            result = listener(message, sender, wrappedSendResponse);
          } catch (err) {
            result = Promise.reject(err);
          }
          const isResultThenable = result !== true && isThenable(result);

          // If the listener didn't returned true or a Promise, or called
          // wrappedSendResponse synchronously, we can exit earlier
          // because there will be no response sent from this listener.
          if (result !== true && !isResultThenable && !didCallSendResponse) {
            return false;
          }

          // A small helper to send the message if the promise resolves
          // and an error if the promise rejects (a wrapped sendMessage has
          // to translate the message into a resolved promise or a rejected
          // promise).
          const sendPromisedResult = promise => {
            promise.then(msg => {
              // send the message value.
              sendResponse(msg);
            }, error => {
              // Send a JSON representation of the error if the rejected value
              // is an instance of error, or the object itself otherwise.
              let message;
              if (error && (error instanceof Error || typeof error.message === "string")) {
                message = error.message;
              } else {
                message = "An unexpected error occurred";
              }
              sendResponse({
                __mozWebExtensionPolyfillReject__: true,
                message
              });
            }).catch(err => {
              // Print an error on the console if unable to send the response.
              console.error("Failed to send onMessage rejected reply", err);
            });
          };

          // If the listener returned a Promise, send the resolved value as a
          // result, otherwise wait the promise related to the wrappedSendResponse
          // callback to resolve and send it as a response.
          if (isResultThenable) {
            sendPromisedResult(result);
          } else {
            sendPromisedResult(sendResponsePromise);
          }

          // Let Chrome know that the listener is replying.
          return true;
        };
      });
      const wrappedSendMessageCallback = ({
        reject,
        resolve
      }, reply) => {
        if (extensionAPIs.runtime.lastError) {
          // Detect when none of the listeners replied to the sendMessage call and resolve
          // the promise to undefined as in Firefox.
          // See https://github.com/mozilla/webextension-polyfill/issues/130
          if (extensionAPIs.runtime.lastError.message === CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE) {
            resolve();
          } else {
            reject(new Error(extensionAPIs.runtime.lastError.message));
          }
        } else if (reply && reply.__mozWebExtensionPolyfillReject__) {
          // Convert back the JSON representation of the error into
          // an Error instance.
          reject(new Error(reply.message));
        } else {
          resolve(reply);
        }
      };
      const wrappedSendMessage = (name, metadata, apiNamespaceObj, ...args) => {
        if (args.length < metadata.minArgs) {
          throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
        }
        if (args.length > metadata.maxArgs) {
          throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
        }
        return new Promise((resolve, reject) => {
          const wrappedCb = wrappedSendMessageCallback.bind(null, {
            resolve,
            reject
          });
          args.push(wrappedCb);
          apiNamespaceObj.sendMessage(...args);
        });
      };
      const staticWrappers = {
        devtools: {
          network: {
            onRequestFinished: wrapEvent(onRequestFinishedWrappers)
          }
        },
        runtime: {
          onMessage: wrapEvent(onMessageWrappers),
          onMessageExternal: wrapEvent(onMessageWrappers),
          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
            minArgs: 1,
            maxArgs: 3
          })
        },
        tabs: {
          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
            minArgs: 2,
            maxArgs: 3
          })
        }
      };
      const settingMetadata = {
        clear: {
          minArgs: 1,
          maxArgs: 1
        },
        get: {
          minArgs: 1,
          maxArgs: 1
        },
        set: {
          minArgs: 1,
          maxArgs: 1
        }
      };
      apiMetadata.privacy = {
        network: {
          "*": settingMetadata
        },
        services: {
          "*": settingMetadata
        },
        websites: {
          "*": settingMetadata
        }
      };
      return wrapObject(extensionAPIs, staticWrappers, apiMetadata);
    };

    // The build process adds a UMD wrapper around this file, which makes the
    // `module` variable available.
    module.exports = wrapAPIs(chrome);
  } else {
    module.exports = globalThis.browser;
  }
});
//# sourceMappingURL=browser-polyfill.js.map


/***/ }),

/***/ "./shared/js/defaults.js":
/*!*******************************!*\
  !*** ./shared/js/defaults.js ***!
  \*******************************/
/***/ ((module) => {

module.exports = {
  fopDelay: 1000,
  flipToAnswers: true,
  fopFlipDelay: 2000,
  profilesPerBatch: 10,
  targetQueuedTabConcurrency: 4,
  coordinatorAutoStartOnBrowserStart: false,
  nukedPostRetentionDays: 30,
  maxRememberedNukedPosts: 10000
};

/***/ }),

/***/ "./shared/js/jobState.js":
/*!*******************************!*\
  !*** ./shared/js/jobState.js ***!
  \*******************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
var _require = __webpack_require__(/*! ./subject */ "./shared/js/subject.js"),
  normalizeQuoraProfileHref = _require.normalizeQuoraProfileHref;
var JOB_SCHEMA_VERSION = 2;
var DEFAULT_ACTION_KIND = 'mute-block';
var UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute';
var JOB_EVENT_ENQUEUED = 'ENQUEUED';
var JOB_EVENT_TAB_OPENED = 'TAB_OPENED';
var JOB_EVENT_CLAIMED = 'CLAIMED';
var JOB_EVENT_MILESTONE = 'MILESTONE';
var JOB_EVENT_HEARTBEAT = 'HEARTBEAT';
var JOB_EVENT_TERMINAL = 'TERMINAL';
var JOB_EVENT_TAB_REMOVED = 'TAB_REMOVED';
var JOB_EVENT_LEASE_EXPIRED = 'LEASE_EXPIRED';
var JOB_EVENT_PAUSE = 'PAUSE';
var JOB_EVENT_RETRY = 'RETRY';
var TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'canceled']);
var TRANSIENT_PROGRESS_STATUSES = new Set(['queued', 'tab-opening', 'tab-opened', 'awaiting-visibility', 'page-ready', 'retrying', 'muting', 'blocking', 'unmuting', 'unblocking']);
var ACTIVE_PROGRESS_STATUSES = new Set(['tab-opening', 'tab-opened', 'awaiting-visibility', 'page-ready', 'retrying', 'muting', 'blocking', 'unmuting', 'unblocking']);
var VALID_JOB_STATUSES = new Set(['queued', 'opening', 'active', 'acting', 'settling'].concat(_toConsumableArray(TERMINAL_JOB_STATUSES)));
var VALID_JOB_TRANSITIONS = {
  queued: new Set(['opening', 'active', 'succeeded', 'skipped', 'failed', 'canceled']),
  opening: new Set(['queued', 'active', 'failed', 'canceled']),
  active: new Set(['queued', 'acting', 'settling', 'succeeded', 'skipped', 'failed', 'canceled']),
  acting: new Set(['settling', 'succeeded', 'skipped', 'failed', 'canceled']),
  settling: new Set(['succeeded', 'skipped', 'failed', 'canceled']),
  failed: new Set(['queued']),
  skipped: new Set(['queued']),
  succeeded: new Set([]),
  canceled: new Set(['queued'])
};
function normalizeString(value) {
  return "".concat(value || '').trim();
}
function makeEmptyJobMilestones() {
  return {
    tabCreatedAt: 0,
    navigationStartedAt: 0,
    contentOpenedAt: 0,
    actionClaimedAt: 0,
    profileReadyAt: 0,
    muteAttemptedAt: 0,
    blockAttemptedAt: 0,
    closeRequestedAt: 0,
    tabClosedAt: 0
  };
}
var JOB_MILESTONE_FIELDS = Object.keys(makeEmptyJobMilestones());
function normalizeJobMilestoneValue(value) {
  var number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function mergeJobMilestones() {
  var existing = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var patch = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var milestones = _objectSpread(_objectSpread({}, makeEmptyJobMilestones()), existing || {});
  var clearFields = Array.isArray(options.clearFields) ? new Set(options.clearFields) : new Set();
  var _iterator = _createForOfIteratorHelper(JOB_MILESTONE_FIELDS),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var field = _step.value;
      if (clearFields.has(field)) {
        milestones[field] = 0;
        continue;
      }
      var value = normalizeJobMilestoneValue(patch === null || patch === void 0 ? void 0 : patch[field]);
      if (value) milestones[field] = value;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return milestones;
}
function getJobMilestonesFromProgress() {
  var record = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return {
    tabCreatedAt: Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0,
    navigationStartedAt: Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
    contentOpenedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
    actionClaimedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
    profileReadyAt: Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
    muteAttemptedAt: Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
    blockAttemptedAt: Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
    closeRequestedAt: Number.isFinite(record.closeRequestedAt) ? record.closeRequestedAt : 0,
    tabClosedAt: Number.isFinite(record.tabClosedAt) ? record.tabClosedAt : 0
  };
}
function isExplicitSecurityVerificationRecord() {
  var record = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!(record !== null && record !== void 0 && record.securityVerification)) return false;
  var text = [record.securityVerificationReason, record.finalError, record.errorPageUrl, record.lastUrl].concat(_toConsumableArray(Array.isArray(record.events) ? record.events : [])).join(' ');
  return /security verification|verify you are human|just a moment|performing security verification|challenge-platform|cdn-cgi|turnstile/i.test(text);
}
function isSuccessfulUnblockUnmuteRecord() {
  var record = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var status = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : normalizeString(record === null || record === void 0 ? void 0 : record.status);
  if (!record || normalizeString(record.actionKind) !== UNBLOCK_UNMUTE_ACTION_KIND) return false;
  if (record.unblockSucceeded || status === 'unblocked' || status === 'already-unblocked') return true;
  var unblockReason = normalizeString(record.unblockReason);
  var unmuteReason = normalizeString(record.unmuteReason);
  return record.unblockOk === true && record.unmuteOk === true && /^(?:unblocked|already-unblocked|not-blocked|not-blocked-anymore)$/.test(unblockReason) && !/error|failed|not-found/i.test(unmuteReason) && !normalizeString(record.finalError);
}
function mapProgressToJobState() {
  var record = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var status = normalizeString(record === null || record === void 0 ? void 0 : record.status);
  var actionKind = normalizeString(record === null || record === void 0 ? void 0 : record.actionKind) || DEFAULT_ACTION_KIND;
  if (!record) return {
    status: '',
    outcome: '',
    error: '',
    terminal: false
  };
  if (actionKind === UNBLOCK_UNMUTE_ACTION_KIND && isSuccessfulUnblockUnmuteRecord(record, status)) {
    return {
      status: 'succeeded',
      outcome: status === 'already-unblocked' ? 'already-unblocked' : 'unblocked',
      error: '',
      terminal: true
    };
  }
  if (record.blockSucceeded || status === 'blocked' || status === 'already-blocked') {
    return {
      status: 'succeeded',
      outcome: status === 'already-blocked' ? 'already-blocked' : 'blocked',
      error: '',
      terminal: true
    };
  }
  if (status === 'profile-unavailable') {
    return {
      status: 'skipped',
      outcome: 'profile-unavailable',
      error: record.finalError || record.unavailableReason || '',
      terminal: true
    };
  }
  if (status === 'block-attempt-on-following') {
    return {
      status: 'skipped',
      outcome: 'block-attempt-on-following',
      error: '',
      terminal: true
    };
  }
  if (isExplicitSecurityVerificationRecord(record)) {
    return {
      status: 'failed',
      outcome: 'security-verification',
      error: record.finalError || '',
      terminal: true
    };
  }
  if (status === 'error-page') {
    return {
      status: 'failed',
      outcome: 'error-page',
      error: record.finalError || record.errorPageUrl || '',
      terminal: true
    };
  }
  if (status === 'error' || status === 'interrupted') {
    var error = record.finalError || record.muteError || record.blockError || '';
    return {
      status: 'failed',
      outcome: /timeout|timed out|stale/i.test(error) ? 'timeout' : 'action-error',
      error: error,
      terminal: true
    };
  }
  if (status === 'queued') {
    return {
      status: 'queued',
      outcome: '',
      error: '',
      terminal: false
    };
  }
  if (['tab-opening'].includes(status)) {
    return {
      status: 'opening',
      outcome: '',
      error: '',
      terminal: false
    };
  }
  if (['muting', 'blocking', 'unmuting', 'unblocking', 'retrying'].includes(status)) {
    return {
      status: 'acting',
      outcome: '',
      error: '',
      terminal: false
    };
  }
  if (['tab-opened', 'awaiting-visibility', 'page-ready'].includes(status)) {
    return {
      status: 'active',
      outcome: '',
      error: '',
      terminal: false
    };
  }
  return {
    status: '',
    outcome: '',
    error: '',
    terminal: false
  };
}
function mapProgressToCoordinatorState() {
  var record = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var mapped = mapProgressToJobState(record);
  if (mapped.status === 'opening' || mapped.status === 'acting') {
    return _objectSpread(_objectSpread({}, mapped), {}, {
      status: 'active'
    });
  }
  return mapped;
}
function isTransientProgressStatus(status) {
  return TRANSIENT_PROGRESS_STATUSES.has(normalizeString(status));
}
function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(normalizeString(status));
}

// getNextCoordinatorQueueSequence computes the processing-order value for a
// freshly-enqueued or freshly-retried queue item: strictly greater than
// every queueSequence currently in the map, so the item sorts to the back
// of processing order instead of keeping whatever position it happened to
// land at when its key was first inserted into the durable queue object (a
// plain JS object never reorders an existing key on reassignment, so
// without an explicit sequence field, a chronically-retried item stays at
// its original position forever and can starve fresher work sitting behind
// it -- see entropy-reduction-action-plan-2026-09-09.md, "queue processing
// order", 2026-09-11/12). No separate persisted counter: the next value is
// always derived from whatever queue is already in hand, so assigning one
// costs a read, not an extra durable write beyond the item's own record.
function getNextCoordinatorQueueSequence() {
  var queue = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var max = 0;
  for (var _i = 0, _Object$values = Object.values(queue || {}); _i < _Object$values.length; _i++) {
    var item = _Object$values[_i];
    var sequence = Number.parseInt(item === null || item === void 0 ? void 0 : item.queueSequence, 10) || 0;
    if (sequence > max) max = sequence;
  }
  return max + 1;
}
function isValidJobStatus(status) {
  return VALID_JOB_STATUSES.has(normalizeString(status));
}
function canTransitionJobStatus(fromStatus, toStatus) {
  var _VALID_JOB_TRANSITION;
  var from = normalizeString(fromStatus);
  var to = normalizeString(toStatus);
  if (!isValidJobStatus(from) || !isValidJobStatus(to)) return false;
  if (from === to) return true;
  return !!((_VALID_JOB_TRANSITION = VALID_JOB_TRANSITIONS[from]) !== null && _VALID_JOB_TRANSITION !== void 0 && _VALID_JOB_TRANSITION.has(to));
}
function getActionKindForRequestedAction() {
  var action = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  return normalizeString(action) === UNBLOCK_UNMUTE_ACTION_KIND ? UNBLOCK_UNMUTE_ACTION_KIND : DEFAULT_ACTION_KIND;
}
function getExecutorTabActionForActionKind() {
  var actionKind = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  return getActionKindForRequestedAction(actionKind) === UNBLOCK_UNMUTE_ACTION_KIND ? UNBLOCK_UNMUTE_ACTION_KIND : 'nuke';
}
function getQueueItemExecutorTabAction() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var fallbackAction = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var trustedActionKind = normalizeString(item === null || item === void 0 ? void 0 : item.actionKind);
  if (trustedActionKind) return getExecutorTabActionForActionKind(trustedActionKind);
  var storedAction = normalizeString((item === null || item === void 0 ? void 0 : item.executorTabAction) || (item === null || item === void 0 ? void 0 : item.tabAction));
  if (storedAction === 'nuke' || storedAction === UNBLOCK_UNMUTE_ACTION_KIND) return storedAction;
  var fallback = normalizeString(fallbackAction);
  if (fallback === 'nuke' || fallback === UNBLOCK_UNMUTE_ACTION_KIND) return fallback;
  return 'nuke';
}
function getJobAttemptId() {
  var _item$attempt;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return normalizeString((item === null || item === void 0 || (_item$attempt = item.attempt) === null || _item$attempt === void 0 ? void 0 : _item$attempt.id) || (item === null || item === void 0 ? void 0 : item.attemptId) || '');
}
function getJobAttemptNumber() {
  var _item$attempt2;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var nested = Number.parseInt(item === null || item === void 0 || (_item$attempt2 = item.attempt) === null || _item$attempt2 === void 0 ? void 0 : _item$attempt2.number, 10);
  var flat = Number.parseInt(item === null || item === void 0 ? void 0 : item.attemptNumber, 10);
  if (Number.isFinite(nested) && nested > 0) return nested;
  if (Number.isFinite(flat) && flat > 0) return flat;
  return 0;
}
function getJobEventTime() {
  var event = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Number.parseInt(event.at || event.now, 10) || Date.now();
}
function shouldAcceptJobEventAttempt() {
  var _event$attempt;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var event = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var eventAttemptId = normalizeString(event.attemptId || ((_event$attempt = event.attempt) === null || _event$attempt === void 0 ? void 0 : _event$attempt.id) || '');
  var currentAttemptId = getJobAttemptId(item);
  if (!eventAttemptId || !currentAttemptId) return true;
  return eventAttemptId === currentAttemptId;
}
function shouldAcceptRetrySourceAttempt() {
  var _event$sourceAttempt, _event$sourceAttempt2;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var event = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var sourceAttemptId = normalizeString(event.sourceAttemptId || ((_event$sourceAttempt = event.sourceAttempt) === null || _event$sourceAttempt === void 0 ? void 0 : _event$sourceAttempt.id) || '');
  var sourceAttemptNumber = Number.parseInt(event.sourceAttemptNumber || ((_event$sourceAttempt2 = event.sourceAttempt) === null || _event$sourceAttempt2 === void 0 ? void 0 : _event$sourceAttempt2.number), 10) || 0;
  if (!sourceAttemptId && !sourceAttemptNumber) return true;
  var currentAttemptId = getJobAttemptId(item);
  var currentAttemptNumber = getJobAttemptNumber(item);
  if (!sourceAttemptId || !sourceAttemptNumber || !currentAttemptId || !currentAttemptNumber) return false;
  return sourceAttemptId === currentAttemptId && sourceAttemptNumber === currentAttemptNumber;
}
function updateJobAttempt() {
  var _event$attempt2, _event$attempt3, _ref, _event$tabId;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var event = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var attemptId = normalizeString(event.attemptId || ((_event$attempt2 = event.attempt) === null || _event$attempt2 === void 0 ? void 0 : _event$attempt2.id) || getJobAttemptId(item));
  var attemptNumber = Number.parseInt(event.attemptNumber || ((_event$attempt3 = event.attempt) === null || _event$attempt3 === void 0 ? void 0 : _event$attempt3.number), 10) || getJobAttemptNumber(item);
  var existing = item !== null && item !== void 0 && item.attempt && _typeof(item.attempt) === 'object' ? item.attempt : null;
  if (!existing) {
    return {
      attemptId: attemptId,
      attemptNumber: attemptNumber
    };
  }
  return {
    attemptId: attemptId,
    attemptNumber: attemptNumber,
    attempt: _objectSpread(_objectSpread({}, existing), {}, {
      id: attemptId,
      number: attemptNumber,
      claimedTabId: event.clearClaim === true ? null : (_ref = (_event$tabId = event.tabId) !== null && _event$tabId !== void 0 ? _event$tabId : existing.claimedTabId) !== null && _ref !== void 0 ? _ref : null,
      claimedAt: Number.parseInt(event.claimedAt, 10) || existing.claimedAt || 0,
      heartbeatAt: Number.parseInt(event.heartbeatAt, 10) || existing.heartbeatAt || 0,
      leaseExpiresAt: Number.parseInt(event.leaseExpiresAt, 10) || existing.leaseExpiresAt || 0
    })
  };
}
function buildJobReducerResult(item, nextItem) {
  var accepted = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
  var reason = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : '';
  return {
    item: nextItem,
    accepted: accepted,
    changed: JSON.stringify(item || {}) !== JSON.stringify(nextItem || {}),
    reason: reason
  };
}
function applyJobStatusTransition() {
  var _ref2, _event$tabId2;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var status = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var event = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var nextStatus = normalizeString(status);
  var currentStatus = normalizeString(item.status || 'queued') || 'queued';
  if (!isValidJobStatus(nextStatus)) {
    return buildJobReducerResult(item, item, false, 'invalid-status');
  }
  if (!canTransitionJobStatus(currentStatus, nextStatus)) {
    return buildJobReducerResult(item, item, false, 'invalid-transition');
  }
  var now = getJobEventTime(event);
  var terminal = isTerminalJobStatus(nextStatus);
  var milestones = mergeJobMilestones(item.milestones || {}, event.milestones || {}, {
    clearFields: event.clearMilestones
  });
  if (event.tabClosedAt || event.type === JOB_EVENT_TAB_REMOVED) {
    milestones.tabClosedAt = Number.parseInt(event.tabClosedAt, 10) || now;
  }
  if (event.closeRequestedAt || event.type === JOB_EVENT_PAUSE) {
    milestones.closeRequestedAt = Number.parseInt(event.closeRequestedAt, 10) || now;
  }
  if (event.tabCreatedAt || event.type === JOB_EVENT_TAB_OPENED) {
    milestones.tabCreatedAt = Number.parseInt(event.tabCreatedAt, 10) || now;
    milestones.navigationStartedAt = Number.parseInt(event.navigationStartedAt, 10) || milestones.navigationStartedAt || now;
  }
  if (event.contentOpenedAt || nextStatus === 'active') {
    milestones.contentOpenedAt = Number.parseInt(event.contentOpenedAt, 10) || milestones.contentOpenedAt || now;
  }
  var attemptPatch = updateJobAttempt(item, event);
  var nextItem = _objectSpread(_objectSpread(_objectSpread({}, item), attemptPatch), {}, {
    status: nextStatus,
    outcome: terminal ? normalizeString(event.outcome || item.outcome || '') : '',
    error: terminal ? normalizeString(event.error || '') : '',
    updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, now),
    queuedAt: nextStatus === 'queued' ? now : item.queuedAt || 0,
    activeAt: nextStatus === 'active' || nextStatus === 'acting' || nextStatus === 'settling' ? item.activeAt || now : nextStatus === 'queued' ? 0 : item.activeAt || 0,
    terminalAt: terminal ? Number.parseInt(event.terminalAt || event.tabClosedAt, 10) || now : 0,
    tabId: terminal || nextStatus === 'queued' ? null : (_ref2 = (_event$tabId2 = event.tabId) !== null && _event$tabId2 !== void 0 ? _event$tabId2 : item.tabId) !== null && _ref2 !== void 0 ? _ref2 : null,
    actionLease: terminal || nextStatus === 'queued' ? null : item.actionLease || null,
    actionLeaseReleasedAt: terminal ? now : nextStatus === 'queued' ? 0 : item.actionLeaseReleasedAt || 0,
    actionLeaseReleaseReason: terminal || nextStatus === 'queued' ? normalizeString(event.reason || '') : item.actionLeaseReleaseReason || '',
    milestones: milestones
  });
  return buildJobReducerResult(item, nextItem);
}

// --- Rolled-back queued tab retry classification -------------------------
// Promoted from swRolledBackQueuedTabRetryClassification.js into the reducer
// core (P3-5/P3-6 design correction, 2026-09-17, see
// sw-state-machine-decomposition-plan-2026-09-01.md): every predicate below
// is a pure, single-argument function of a queue item alone, so
// reduceJobEvent computes them itself instead of trusting a caller-built
// copy that could go stale (a caller reads the item at one point in time,
// then the item can change again before its computed facts reach the
// reducer) or simply disagree with the item's own fields due to a bug at
// one of several call sites. swRolledBackQueuedTabRetryClassification.js no
// longer defines these itself -- sw.js (the composition root) threads them
// from here into that module's deps.handlers instead, so its own remaining
// exports (and its five callers in sw.js, plus the harness's direct
// sw.isQueuedTabRetryBudgetReleaseReason/shouldAdvanceRolledBackQueuedTabBeforeOpen
// test hooks) keep working under the same names.
//
// isCoordinatorQueueAuthoritativeItem is deliberately NOT re-exported here:
// its canonical home stays swCoordinatorStatusRules.js (used far beyond this
// one policy), and duplicating its one-line body locally -- rather than
// wiring a new cross-module dependency into this reducer core -- is the
// cheaper, lower-risk way to let the reducer compute it itself. See the
// decomposition plan for the fuller rationale.
var ACTIVE_JOB_STATUSES = new Set(['opening', 'active', 'acting', 'settling']);
var DEFAULT_QUEUED_TAB_MAX_RETRIES = 1; // mirrors sw.js's STALE_QUEUED_TAB_MAX_RETRIES
var EXHAUSTED_ROLLBACK_RECOVERY_LIMIT = 3; // mirrors sw.js's COORDINATOR_EXHAUSTED_ROLLBACK_RECOVERY_LIMIT
var QUEUE_LOAD_PRESSURE_RECOVERY_WINDOW_MS = 120000; // mirrors sw.js's QUEUE_LOAD_THROTTLE_MAX_MS
var QUEUE_LOAD_PRESSURE_REASON_PATTERN = /(?:content-script|claim-nudge|storage|loading|unscriptable|queue-load)/i;
function isActiveJobStatus() {
  var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  return ACTIVE_JOB_STATUSES.has(normalizeString(status));
}
function isCoordinatorQueueAuthoritativeItem() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  return (item === null || item === void 0 ? void 0 : item.serviceWorkerOwned) === true || "".concat((item === null || item === void 0 ? void 0 : item.executorOwner) || '') === 'service-worker';
}
function isQueuedTabRetryBudgetReleaseReason() {
  var reason = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var normalized = "".concat(reason || '').trim();
  return normalized === 'active-transition-failed' || normalized === 'queued-tab-release-fast-executor-preflight' || normalized === 'executor-plan-active-transition-retry-budget-exhausted' || /(?:^|-)active-missing-tab(?:-|$)/.test(normalized) || /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(normalized) || /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(normalized) || /(?:^|-)fast-executor-preflight(?:-|$)/.test(normalized) || /(?:^|-)content-script-(?:ensure-failed|unscriptable|version-mismatch)(?:-|$)/.test(normalized) || /(?:^|-)claim-nudge-not-accepted(?:-|$)/.test(normalized) || /(?:^|-)fresh-content-script-recovery(?:-|$)/.test(normalized) || /(?:^|-)queued-live-tab-adoption-load-pressure(?:-|$)/.test(normalized) || /(?:^|-)queued-tab-final-open-decision-timeout(?:-|$)/.test(normalized) || /(?:^|-)queued-stale-runtime-(?:missing-metadata|missing-queued-action|action-already-pruned|action-drained-before-authority|action-pruned-after-fill-timeout)(?:-|$)/.test(normalized);
}
function shouldAdvanceRolledBackQueuedTabBeforeOpen() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!item || isTerminalJobStatus(item.status) || isActiveJobStatus(item.status)) return false;
  return isQueuedTabRetryBudgetReleaseReason(item.actionLeaseReleaseReason) && !!getJobAttemptId(item) && !!getJobAttemptNumber(item);
}
function getRolledBackQueuedTabRetryAttempt() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Math.max(Number.parseInt(item === null || item === void 0 ? void 0 : item.retryCount, 10) || 0, Number.parseInt(item === null || item === void 0 ? void 0 : item.retryAttempt, 10) || 0);
}
function getJobQueuedTabMaxRetries() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var configured = Number.parseInt(item === null || item === void 0 ? void 0 : item.maxRetries, 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_QUEUED_TAB_MAX_RETRIES;
}
function isExhaustedRolledBackQueuedTabRetry() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!shouldAdvanceRolledBackQueuedTabBeforeOpen(item)) return false;
  return getRolledBackQueuedTabRetryAttempt(item) >= getJobQueuedTabMaxRetries(item);
}
function isActiveTransitionRolledBackQueuedTabRetry() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var reason = "".concat((item === null || item === void 0 ? void 0 : item.actionLeaseReleaseReason) || '').trim();
  return reason === 'active-transition-failed' || /(?:^|-)active-transition(?:-|$)/.test(reason);
}
function isRuntimeDisappearedRolledBackQueuedTabRetry() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var reason = "".concat((item === null || item === void 0 ? void 0 : item.actionLeaseReleaseReason) || '').trim();
  return /(?:^|-)active-missing-tab(?:-|$)/.test(reason) || /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(reason) || /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(reason);
}
function isTransientOpenRolledBackQueuedTabRetry() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var reason = "".concat((item === null || item === void 0 ? void 0 : item.actionLeaseReleaseReason) || '').trim();
  if (!reason) return false;
  if (isActiveTransitionRolledBackQueuedTabRetry(item)) return false;
  if (isRuntimeDisappearedRolledBackQueuedTabRetry(item)) return false;
  return isQueuedTabRetryBudgetReleaseReason(reason);
}
function hasLiveQueuedTabRuntimeSignal() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var tabId = Number.parseInt((item === null || item === void 0 ? void 0 : item.tabId) || (item === null || item === void 0 ? void 0 : item.activeTabId) || 0, 10);
  if (Number.isFinite(tabId) && tabId > 0) return true;
  return (Number.parseInt(item === null || item === void 0 ? void 0 : item.activeAt, 10) || 0) > 0;
}

// isRecentQueueLoadPressureReading interprets a RAW, point-in-time
// queue-load-throttle reading (intent.queueLoadPressure: {active, reason,
// lastPressureAt}, captured by the caller from live, mutable throttle
// state) -- the regex/window policy check itself lives here, in the
// reducer, rather than at each call site, so every caller that hands the
// reducer the same raw reading gets the same answer.
function isRecentQueueLoadPressureReading() {
  var pressure = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var now = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : Date.now();
  var reason = normalizeString(pressure === null || pressure === void 0 ? void 0 : pressure.reason);
  if (!reason || !QUEUE_LOAD_PRESSURE_REASON_PATTERN.test(reason)) return false;
  if ((pressure === null || pressure === void 0 ? void 0 : pressure.active) === true) return true;
  var lastPressureAt = Number.parseInt(pressure === null || pressure === void 0 ? void 0 : pressure.lastPressureAt, 10) || 0;
  if (!lastPressureAt) return false;
  var windowMs = Number.parseInt(pressure === null || pressure === void 0 ? void 0 : pressure.windowMs, 10) || QUEUE_LOAD_PRESSURE_RECOVERY_WINDOW_MS;
  return (Number.parseInt(now, 10) || Date.now()) - lastPressureAt <= windowMs;
}

// isExhaustedRollbackRecoveryApproved centralizes the
// shouldRecoverExhaustedRolledBackQueuedTabRetry policy (three approval
// paths -- queueOnlyAuthority shortcut, recoverActiveTransitionFailures
// reason-match, queue-pressure recovery nested inside the reason-match
// branch -- plus the exhaustedRolledBackRecoveryCount cap that closed the
// infinite-recovery-loop bug) as one reducer-decided question instead of
// three independently-branching call sites.
//
// `intent` carries only what the reducer genuinely cannot derive from
// `item` itself: the caller's own recovery-mode flags (queueOnlyAuthority,
// recoverActiveTransitionFailures, recoverTransientOpenRetry,
// recoverQueueLoadPressure, and serviceWorkerOwned's caller-side override)
// plus a raw, point-in-time queue-load-pressure reading
// (intent.queueLoadPressure). Every other fact the approval decision used
// to require from a caller-built bundle -- isExhausted, activeTransitionRetry,
// runtimeDisappearedRetry, transientOpenRetry, queueAuthoritative, and
// serviceWorkerOwned's item-derived half -- is computed here, directly from
// `item`, so a caller can no longer approve a recovery the item's own
// fields don't actually support. `intent.recoveryLimit` is an optional
// override of EXHAUSTED_ROLLBACK_RECOVERY_LIMIT for callers/tests that need
// a different cap; ordinary callers can omit it entirely. See
// swRolledBackQueuedTabRetryClassification.js's
// shouldRecoverExhaustedRolledBackQueuedTabRetry and
// buildForcedRolledBackQueuedTabRetryItem for the two call sites that now
// build this same narrow intent from the same caller options
// (P3-5/P3-6, sw-state-machine-decomposition-plan-2026-09-01.md).
function isExhaustedRollbackRecoveryApproved() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var intent = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var now = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : Date.now();
  if (!isExhaustedRolledBackQueuedTabRetry(item)) return false;
  var count = Number.parseInt(item === null || item === void 0 ? void 0 : item.exhaustedRolledBackRecoveryCount, 10) || 0;
  var limit = Number.parseInt(intent.recoveryLimit, 10) || EXHAUSTED_ROLLBACK_RECOVERY_LIMIT;
  if (count >= limit) return false;
  if (intent.queueOnlyAuthority === true) return true;
  if (intent.recoverActiveTransitionFailures !== true) return false;
  var activeTransitionRetry = isActiveTransitionRolledBackQueuedTabRetry(item);
  var runtimeDisappearedRetry = isRuntimeDisappearedRolledBackQueuedTabRetry(item);
  var transientOpenRetry = isTransientOpenRolledBackQueuedTabRetry(item);
  var queueAuthoritative = isCoordinatorQueueAuthoritativeItem(item);
  var serviceWorkerOwned = intent.serviceWorkerOwned === true || (item === null || item === void 0 ? void 0 : item.serviceWorkerOwned) === true || (item === null || item === void 0 ? void 0 : item.executorOwner) === 'service-worker';
  var pressureOpenRetry = intent.recoverQueueLoadPressure === true && transientOpenRetry && queueAuthoritative && serviceWorkerOwned && !hasLiveQueuedTabRuntimeSignal(item) && isRecentQueueLoadPressureReading(intent.queueLoadPressure, now);
  var reasonMatched = activeTransitionRetry || runtimeDisappearedRetry || transientOpenRetry && (intent.recoverTransientOpenRetry === true || pressureOpenRetry);
  if (!reasonMatched) return false;
  return queueAuthoritative === true && serviceWorkerOwned === true;
}
function reduceJobEvent() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var event = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var type = normalizeString(event.type);
  if (!type) return buildJobReducerResult(item, item, false, 'missing-event-type');
  if (type === JOB_EVENT_ENQUEUED || type === JOB_EVENT_RETRY) {
    var _event$attempt4, _event$attempt5;
    if (type === JOB_EVENT_RETRY && !shouldAcceptRetrySourceAttempt(item, event)) {
      return buildJobReducerResult(item, item, false, 'stale-retry-source-attempt');
    }
    if (type === JOB_EVENT_RETRY && event.exhaustedRolledBackRecovery && !isExhaustedRollbackRecoveryApproved(item, event.exhaustedRolledBackRecovery, getJobEventTime(event))) {
      return buildJobReducerResult(item, item, false, 'exhausted-rollback-recovery-denied');
    }
    var nextAttemptId = normalizeString(event.attemptId || ((_event$attempt4 = event.attempt) === null || _event$attempt4 === void 0 ? void 0 : _event$attempt4.id) || getJobAttemptId(item));
    var nextAttemptNumber = Number.parseInt(event.attemptNumber || ((_event$attempt5 = event.attempt) === null || _event$attempt5 === void 0 ? void 0 : _event$attempt5.number), 10) || getJobAttemptNumber(item);
    var result = applyJobStatusTransition(item, 'queued', _objectSpread(_objectSpread({}, event), {}, {
      attemptId: nextAttemptId,
      attemptNumber: nextAttemptNumber,
      clearClaim: true
    }));
    if (!result.accepted) return result;
    return buildJobReducerResult(item, _objectSpread(_objectSpread({}, result.item), {}, {
      outcome: '',
      error: '',
      retryCount: Number.parseInt(event.retryCount, 10) || item.retryCount || 0,
      queueSequence: Number.parseInt(event.queueSequence, 10) || item.queueSequence || 0,
      lastRetryAt: Number.parseInt(event.lastRetryAt, 10) || result.item.queuedAt || 0,
      terminalAt: 0
    }, event.exhaustedRolledBackRecovery ? {
      exhaustedRolledBackRecoveryCount: (Number.parseInt(item.exhaustedRolledBackRecoveryCount, 10) || 0) + 1
    } : {}));
  }
  if (!shouldAcceptJobEventAttempt(item, event)) {
    return buildJobReducerResult(item, item, false, 'stale-attempt');
  }
  if (type === JOB_EVENT_TAB_OPENED) {
    return applyJobStatusTransition(item, 'opening', event);
  }
  if (type === JOB_EVENT_CLAIMED || type === JOB_EVENT_HEARTBEAT) {
    return applyJobStatusTransition(item, 'active', event);
  }
  if (type === JOB_EVENT_MILESTONE) {
    return applyJobStatusTransition(item, normalizeString(event.status || 'active'), event);
  }
  if (type === JOB_EVENT_PAUSE) {
    return applyJobStatusTransition(item, 'canceled', _objectSpread({
      outcome: 'paused',
      error: 'Paused by user'
    }, event));
  }
  if (type === JOB_EVENT_TAB_REMOVED || type === JOB_EVENT_LEASE_EXPIRED) {
    return applyJobStatusTransition(item, normalizeString(event.status || 'failed'), _objectSpread({
      outcome: 'timeout',
      error: 'Queued tab closed before reaching a terminal state'
    }, event));
  }
  if (type === JOB_EVENT_TERMINAL) {
    return applyJobStatusTransition(item, normalizeString(event.status || 'failed'), event);
  }
  return buildJobReducerResult(item, item, false, 'unknown-event-type');
}
function isRetryableJobFailure() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (normalizeString(item === null || item === void 0 ? void 0 : item.status) !== 'failed') return false;
  var outcome = normalizeString(item === null || item === void 0 ? void 0 : item.outcome);
  if (outcome === 'security-verification') return false;
  if (outcome === 'timeout' || outcome === 'action-error') return true;
  return /timeout|timed out|stale|interrupted/i.test("".concat((item === null || item === void 0 ? void 0 : item.error) || ''));
}
function isRetryableJobFailureFromProgress() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var record = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
  if (isRetryableJobFailure(item)) return true;
  if (normalizeString(item === null || item === void 0 ? void 0 : item.status) !== 'failed') return false;
  if (normalizeString(item === null || item === void 0 ? void 0 : item.outcome) !== 'security-verification') return false;
  if (isExplicitSecurityVerificationRecord(record)) return false;
  return isTransientProgressStatus(record === null || record === void 0 ? void 0 : record.status);
}
function makeCanonicalSubject() {
  var profileHref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var href = normalizeQuoraProfileHref(profileHref);
  if (!href) return null;
  var slug = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
  return {
    kind: 'quora-profile',
    href: href,
    slug: slug,
    aliases: []
  };
}
function makeJobDedupeKey() {
  var _options$scope, _options$scope2;
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var subject = options.canonicalSubject || makeCanonicalSubject(options.profileHref || options.targetProfileHref || options.requestedUrl || '');
  if (!(subject !== null && subject !== void 0 && subject.href)) return '';
  var scope = normalizeString(options.scopeKey || options.runId || ((_options$scope = options.scope) === null || _options$scope === void 0 ? void 0 : _options$scope.runId) || ((_options$scope2 = options.scope) === null || _options$scope2 === void 0 ? void 0 : _options$scope2.type) || 'global');
  var actionKind = normalizeString(options.actionKind) || DEFAULT_ACTION_KIND;
  return "".concat(scope, "|").concat(actionKind, "|").concat(subject.href);
}
function normalizeAttempt() {
  var _existing$max, _ref3, _existing$claimedTabI;
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var existing = item !== null && item !== void 0 && item.attempt && _typeof(item.attempt) === 'object' ? item.attempt : {};
  var flatAttempt = Number.parseInt(item === null || item === void 0 ? void 0 : item.attempt, 10);
  var number = Number.parseInt(existing.number, 10) || (Number.isFinite(flatAttempt) && flatAttempt > 0 ? flatAttempt : 0);
  return {
    id: normalizeString(existing.id),
    number: number,
    max: Number.parseInt((_existing$max = existing.max) !== null && _existing$max !== void 0 ? _existing$max : item === null || item === void 0 ? void 0 : item.maxAttempts, 10) || 1,
    claimedTabId: (_ref3 = (_existing$claimedTabI = existing.claimedTabId) !== null && _existing$claimedTabI !== void 0 ? _existing$claimedTabI : item === null || item === void 0 ? void 0 : item.tabId) !== null && _ref3 !== void 0 ? _ref3 : null,
    claimedAt: Number.parseInt(existing.claimedAt, 10) || 0,
    leaseExpiresAt: Number.parseInt(existing.leaseExpiresAt, 10) || 0,
    heartbeatAt: Number.parseInt(existing.heartbeatAt, 10) || 0
  };
}
function upgradeCoordinatorQueueItem() {
  var _source$source, _source$source2, _source$source3, _source$source4;
  var key = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var item = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var source = item && _typeof(item) === 'object' ? item : {};
  var targetProfileHref = normalizeQuoraProfileHref(source.targetProfileHref || source.requestedUrl || source.dedupeKey || key || '');
  var canonicalSubject = makeCanonicalSubject(targetProfileHref);
  var actionKind = normalizeString(source.actionKind || options.actionKind) || DEFAULT_ACTION_KIND;
  var scope = source.scope && _typeof(source.scope) === 'object' ? source.scope : {
    type: ((_source$source = source.source) === null || _source$source === void 0 ? void 0 : _source$source.type) || options.sourceType || 'unknown',
    runId: source.runId || options.runId || '',
    sourcePageUrl: ((_source$source2 = source.source) === null || _source$source2 === void 0 ? void 0 : _source$source2.pageUrl) || '',
    spaceKey: ((_source$source3 = source.source) === null || _source$source3 === void 0 ? void 0 : _source$source3.spaceKey) || '',
    spaceCategory: ((_source$source4 = source.source) === null || _source$source4 === void 0 ? void 0 : _source$source4.spaceCategory) || ''
  };
  var dedupeKey = source.dedupeKey && source.dedupeKey.includes('|') ? source.dedupeKey : makeJobDedupeKey({
    canonicalSubject: canonicalSubject,
    actionKind: actionKind,
    scope: scope
  });
  return _objectSpread(_objectSpread({}, source), {}, {
    schemaVersion: JOB_SCHEMA_VERSION,
    canonicalSubject: canonicalSubject,
    actionKind: actionKind,
    scope: scope,
    dedupeKey: dedupeKey,
    targetProfileHref: targetProfileHref || source.targetProfileHref || '',
    attempt: normalizeAttempt(source),
    milestones: _objectSpread(_objectSpread({}, makeEmptyJobMilestones()), source.milestones || {})
  });
}
module.exports = {
  ACTIVE_PROGRESS_STATUSES: ACTIVE_PROGRESS_STATUSES,
  DEFAULT_ACTION_KIND: DEFAULT_ACTION_KIND,
  JOB_EVENT_CLAIMED: JOB_EVENT_CLAIMED,
  JOB_EVENT_ENQUEUED: JOB_EVENT_ENQUEUED,
  JOB_EVENT_HEARTBEAT: JOB_EVENT_HEARTBEAT,
  JOB_EVENT_LEASE_EXPIRED: JOB_EVENT_LEASE_EXPIRED,
  JOB_EVENT_MILESTONE: JOB_EVENT_MILESTONE,
  JOB_EVENT_PAUSE: JOB_EVENT_PAUSE,
  JOB_EVENT_RETRY: JOB_EVENT_RETRY,
  JOB_EVENT_TAB_OPENED: JOB_EVENT_TAB_OPENED,
  JOB_EVENT_TAB_REMOVED: JOB_EVENT_TAB_REMOVED,
  JOB_EVENT_TERMINAL: JOB_EVENT_TERMINAL,
  JOB_SCHEMA_VERSION: JOB_SCHEMA_VERSION,
  TERMINAL_JOB_STATUSES: TERMINAL_JOB_STATUSES,
  TRANSIENT_PROGRESS_STATUSES: TRANSIENT_PROGRESS_STATUSES,
  UNBLOCK_UNMUTE_ACTION_KIND: UNBLOCK_UNMUTE_ACTION_KIND,
  canTransitionJobStatus: canTransitionJobStatus,
  getActionKindForRequestedAction: getActionKindForRequestedAction,
  getExecutorTabActionForActionKind: getExecutorTabActionForActionKind,
  getJobMilestonesFromProgress: getJobMilestonesFromProgress,
  getNextCoordinatorQueueSequence: getNextCoordinatorQueueSequence,
  getQueueItemExecutorTabAction: getQueueItemExecutorTabAction,
  getRolledBackQueuedTabRetryAttempt: getRolledBackQueuedTabRetryAttempt,
  isActiveTransitionRolledBackQueuedTabRetry: isActiveTransitionRolledBackQueuedTabRetry,
  isExhaustedRolledBackQueuedTabRetry: isExhaustedRolledBackQueuedTabRetry,
  isExplicitSecurityVerificationRecord: isExplicitSecurityVerificationRecord,
  isQueuedTabRetryBudgetReleaseReason: isQueuedTabRetryBudgetReleaseReason,
  isRetryableJobFailure: isRetryableJobFailure,
  isRetryableJobFailureFromProgress: isRetryableJobFailureFromProgress,
  isRuntimeDisappearedRolledBackQueuedTabRetry: isRuntimeDisappearedRolledBackQueuedTabRetry,
  isTerminalJobStatus: isTerminalJobStatus,
  isTransientOpenRolledBackQueuedTabRetry: isTransientOpenRolledBackQueuedTabRetry,
  isTransientProgressStatus: isTransientProgressStatus,
  makeCanonicalSubject: makeCanonicalSubject,
  makeEmptyJobMilestones: makeEmptyJobMilestones,
  makeJobDedupeKey: makeJobDedupeKey,
  mapProgressToCoordinatorState: mapProgressToCoordinatorState,
  mapProgressToJobState: mapProgressToJobState,
  reduceJobEvent: reduceJobEvent,
  shouldAdvanceRolledBackQueuedTabBeforeOpen: shouldAdvanceRolledBackQueuedTabBeforeOpen,
  upgradeCoordinatorQueueItem: upgradeCoordinatorQueueItem
};

/***/ }),

/***/ "./shared/js/nukedPosts.js":
/*!*********************************!*\
  !*** ./shared/js/nukedPosts.js ***!
  \*********************************/
/***/ ((module) => {

function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var SPACE_NUKED_POSTS_KEY = 'mbSpaceNukedPosts';
var NUKED_POST_RETENTION_DAYS_KEY = 'nukedPostRetentionDays';
var MAX_REMEMBERED_NUKED_POSTS_KEY = 'maxRememberedNukedPosts';
var DEFAULT_NUKED_POST_RETENTION_DAYS = 30;
var DEFAULT_MAX_REMEMBERED_NUKED_POSTS = 10000;
function normalizeRetentionDays(value) {
  var fallback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_NUKED_POST_RETENTION_DAYS;
  var parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
function normalizeMaxRememberedNukedPosts(value) {
  var fallback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_MAX_REMEMBERED_NUKED_POSTS;
  var parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
function getPrunedNukedPosts(records) {
  var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var source = records && _typeof(records) === 'object' ? records : {};
  var retentionDays = normalizeRetentionDays(options.retentionDays, DEFAULT_NUKED_POST_RETENTION_DAYS);
  var maxEntries = normalizeMaxRememberedNukedPosts(options.maxEntries, DEFAULT_MAX_REMEMBERED_NUKED_POSTS);
  var now = Number.isFinite(options.now) ? options.now : Date.now();
  var entries = Object.entries(source).filter(function (_ref) {
    var _ref2 = _slicedToArray(_ref, 2),
      postKey = _ref2[0],
      record = _ref2[1];
    return !!postKey && record && _typeof(record) === 'object';
  }).map(function (_ref3) {
    var _ref4 = _slicedToArray(_ref3, 2),
      postKey = _ref4[0],
      record = _ref4[1];
    var updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
    return [postKey, _objectSpread(_objectSpread({}, record), {}, {
      updatedAt: updatedAt
    })];
  });
  if (retentionDays > 0) {
    var cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    entries = entries.filter(function (_ref5) {
      var _ref6 = _slicedToArray(_ref5, 2),
        record = _ref6[1];
      return record.updatedAt >= cutoff;
    });
  }
  entries.sort(function (left, right) {
    return right[1].updatedAt - left[1].updatedAt || left[0].localeCompare(right[0]);
  });
  if (maxEntries > 0 && entries.length > maxEntries) {
    entries = entries.slice(0, maxEntries);
  }
  return Object.fromEntries(entries);
}
function haveSameNukedPostKeys(left, right) {
  var leftKeys = Object.keys(left || {}).sort();
  var rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(function (key, index) {
    return key === rightKeys[index];
  });
}
module.exports = {
  DEFAULT_MAX_REMEMBERED_NUKED_POSTS: DEFAULT_MAX_REMEMBERED_NUKED_POSTS,
  DEFAULT_NUKED_POST_RETENTION_DAYS: DEFAULT_NUKED_POST_RETENTION_DAYS,
  MAX_REMEMBERED_NUKED_POSTS_KEY: MAX_REMEMBERED_NUKED_POSTS_KEY,
  NUKED_POST_RETENTION_DAYS_KEY: NUKED_POST_RETENTION_DAYS_KEY,
  SPACE_NUKED_POSTS_KEY: SPACE_NUKED_POSTS_KEY,
  getPrunedNukedPosts: getPrunedNukedPosts,
  haveSameNukedPostKeys: haveSameNukedPostKeys,
  normalizeMaxRememberedNukedPosts: normalizeMaxRememberedNukedPosts,
  normalizeRetentionDays: normalizeRetentionDays
};

/***/ }),

/***/ "./shared/js/subject.js":
/*!******************************!*\
  !*** ./shared/js/subject.js ***!
  \******************************/
/***/ ((module) => {

function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
var QUORA_NON_PROFILE_ROOT_PATHS = new Set(['answer', 'bookmarks', 'business', 'careers', 'contact', 'following', 'messages', 'notifications', 'profile', 'question', 'search', 'settings', 'space', 'spaces', 'topic', 'unanswered']);
function sanitizeProfileHrefSlug(slug) {
  var value = "".concat(slug || '').normalize('NFKC').replace(/[?#].*$/g, '').trim();
  if (!value) return '';
  var cutPatterns = [/-amp-(?:ch|oid|share|srid|target|targ|target-type|type)/i, /-(?:ch|oid|share|srid|target|target_type|type)-/i, /-(?:followers?|following|log)-/i, /-https?$/i, /-https?-/i, /-(?:followers?|following|log)$/i];
  var cutIndex = -1;
  for (var _i = 0, _cutPatterns = cutPatterns; _i < _cutPatterns.length; _i++) {
    var pattern = _cutPatterns[_i];
    var match = pattern.exec(value);
    if (!match) continue;
    if (cutIndex === -1 || match.index < cutIndex) {
      cutIndex = match.index;
    }
  }
  if (cutIndex >= 0) {
    value = value.slice(0, cutIndex);
  }
  value = stripDescriptiveProfileSuffix(value);
  value = stripTrailingProfileArtifactToken(value);
  return value.replace(/[-_\s]+$/g, '').trim();
}
function stripDescriptiveProfileSuffix(value) {
  var tokens = "".concat(value || '').split('-').filter(Boolean);
  if (tokens.length < 2) return "".concat(value || '');
  var descriptiveWords = new Set(['a', 'about', 'again', 'and', 'asking', 'bio', 'comment', 'comments', 'details', 'for', 'from', 'he', 'her', 'hers', 'his', 'lets', 'made', 'my', 'of', 'par', 'peoples', 'question', 'quora', 'see', 'she', 'some', 'that', 'the', 'their', 'this', 'those', 'try', 'weird']);
  var isDescriptiveToken = function isDescriptiveToken(token) {
    var normalized = "".concat(token || '').toLowerCase();
    return descriptiveWords.has(normalized) || /^[a-z]{1,3}$/.test(normalized);
  };
  var suffixLooksDescriptive = function suffixLooksDescriptive(suffixTokens) {
    if (!suffixTokens.length) return false;
    if (suffixTokens.length >= 2 && suffixTokens.some(isDescriptiveToken)) return true;
    var first = "".concat(suffixTokens[0] || '').toLowerCase();
    return ['bio', 'details', 'quora'].includes(first);
  };
  var anchorIndex = tokens.findIndex(function (token, index) {
    return index > 0 && /^\d+$/.test(token);
  });
  if (anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
    return tokens.slice(0, anchorIndex + 1).join('-');
  }
  anchorIndex = tokens.findIndex(function (token, index) {
    return /\d+$/.test(token) && index < tokens.length - 1;
  });
  if (anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
    return tokens.slice(0, anchorIndex + 1).join('-');
  }
  return "".concat(value || '');
}
function stripTrailingProfileArtifactToken(value) {
  var tokens = "".concat(value || '').split('-').filter(Boolean);
  if (tokens.length < 2) return "".concat(value || '');
  var lastToken = "".concat(tokens[tokens.length - 1] || '').toLowerCase();
  var previousToken = "".concat(tokens[tokens.length - 2] || '').toLowerCase();
  if (lastToken === 'ch') {
    if (!/^\d+$/.test(previousToken)) return "".concat(value || '');
    tokens.pop();
    return tokens.join('-');
  }
  if (['oid', 'share', 'srid', 'target', 'target_type', 'type'].includes(lastToken)) {
    tokens.pop();
    return tokens.join('-');
  }
  if (['answers', 'posts', 'questions'].includes(lastToken) && tokens.length >= 3) {
    tokens.pop();
    return tokens.join('-');
  }
  return "".concat(value || '');
}
function isLikelyExplicitProfileTargetSlug(slug) {
  var value = sanitizeProfileHrefSlug(slug);
  if (!value) return false;
  var tokens = value.split('-').filter(Boolean);
  if (tokens.length < 2) return false;
  var proseTokens = new Set(['about', 'again', 'answer', 'answers', 'because', 'checking', 'comment', 'comments', 'does', 'freely', 'from', 'have', 'hes', 'into', 'made', 'much', 'post', 'question', 'saves', 'says', 'she', 'states', 'that', 'their', 'this', 'time', 'troll', 'what', 'when', 'where', 'with', 'without']);
  var isNameishToken = function isNameishToken(token) {
    return /^[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z0-9]{2,}$/.test(token) || /^\d+$/.test(token);
  };
  var proseCount = tokens.filter(function (token) {
    return proseTokens.has("".concat(token || '').toLowerCase());
  }).length;
  if (proseCount >= 2) return false;
  var nonNameishCount = tokens.filter(function (token) {
    return !isNameishToken(token);
  }).length;
  if (tokens.length > 4 && nonNameishCount >= 2) return false;
  if (tokens.length > 6 && !tokens.some(function (token) {
    return /^\d+$/.test(token);
  })) return false;
  if (tokens.length > 8) return false;
  return true;
}
function isLikelyExplicitProfileTargetHref(href) {
  var normalizedHref = normalizeQuoraProfileHref(href);
  if (!normalizedHref) return false;
  try {
    var url = new URL(normalizedHref);
    var slug = decodeURIComponent(url.pathname.replace(/^\/profile\//i, ''));
    return isLikelyExplicitProfileTargetSlug(slug);
  } catch (_unused) {
    return false;
  }
}
function isLikelyDirectProfileSlug(slug) {
  var value = "".concat(slug || '').trim();
  if (!value) return false;
  if (/[\/\\?#]/.test(value)) return false;
  var tokens = value.split('-').filter(Boolean);
  if (tokens.length < 2) return false;
  if (tokens.length > 8) return false;
  var isNameishToken = function isNameishToken(token) {
    return /^[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z0-9]{2,}$/.test(token);
  };
  if (tokens.some(function (token) {
    return /^\d+$/.test(token);
  })) return true;
  if (tokens.some(function (token) {
    return /^[A-F0-9]{2}$/i.test(token);
  })) return true;
  if (/^(?:a|an|are|can|could|did|do|does|how|is|should|the|what|when|where|who|why|will|would)$/i.test(tokens[0] || '')) {
    if (/^the$/i.test(tokens[0]) && tokens.length >= 3 && tokens.every(isNameishToken)) {
      return true;
    }
    return false;
  }
  var nameishTokenCount = 0;
  var _iterator = _createForOfIteratorHelper(tokens),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var token = _step.value;
      if (isNameishToken(token)) {
        nameishTokenCount += 1;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return nameishTokenCount >= 2;
}
function getLikelyQuoraProfileSlug(pathname) {
  var parts = "".concat(pathname || '').split('/').filter(Boolean);
  if (!parts.length) return '';
  var firstPart = "".concat(parts[0] || '');
  if (firstPart.toLowerCase() === 'profile') {
    return parts.length >= 2 ? "".concat(parts[1] || '') : '';
  }
  if (parts.length !== 1 || QUORA_NON_PROFILE_ROOT_PATHS.has(firstPart.toLowerCase())) return '';
  if (!/-/.test(firstPart)) return '';
  var decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(firstPart));
  if (!decodedSlug) return '';
  if (!isLikelyDirectProfileSlug(decodedSlug)) return '';
  return firstPart;
}
function getDefaultBaseUrl() {
  var _globalThis$location;
  return ((_globalThis$location = globalThis.location) === null || _globalThis$location === void 0 ? void 0 : _globalThis$location.origin) || 'https://www.quora.com';
}
function normalizeQuoraProfileHref(href) {
  var baseUrl = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : getDefaultBaseUrl();
  if (!href) return null;
  try {
    var _pathParts$;
    var url = new URL(href, baseUrl);
    var hostname = "".concat(url.hostname || '').toLowerCase();
    var isPrimaryQuoraHost = hostname === 'quora.com' || hostname === 'www.quora.com';
    var isQuoraSubdomain = hostname.endsWith('.quora.com');
    if (hostname && !isPrimaryQuoraHost && !isQuoraSubdomain) {
      return null;
    }
    url.search = '';
    url.hash = '';
    var pathParts = url.pathname.split('/').filter(Boolean);
    if (isQuoraSubdomain && !isPrimaryQuoraHost && ((_pathParts$ = pathParts[0]) === null || _pathParts$ === void 0 ? void 0 : _pathParts$.toLowerCase()) !== 'profile') {
      return null;
    }
    var slug = getLikelyQuoraProfileSlug(url.pathname);
    if (!slug) return null;
    var decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(slug));
    if (!decodedSlug) return null;
    if (/[\/\\?#]/.test(decodedSlug)) return null;
    if (/[\u0000-\u001F\u007F]/.test(decodedSlug)) return null;
    return "https://www.quora.com/profile/".concat(encodeURIComponent(decodedSlug));
  } catch (_unused2) {
    return null;
  }
}
function normalizeTabTargetUrl(url) {
  return normalizeQuoraProfileHref(url) || url;
}
module.exports = {
  QUORA_NON_PROFILE_ROOT_PATHS: QUORA_NON_PROFILE_ROOT_PATHS,
  getLikelyQuoraProfileSlug: getLikelyQuoraProfileSlug,
  isLikelyExplicitProfileTargetHref: isLikelyExplicitProfileTargetHref,
  isLikelyExplicitProfileTargetSlug: isLikelyExplicitProfileTargetSlug,
  isLikelyDirectProfileSlug: isLikelyDirectProfileSlug,
  normalizeQuoraProfileHref: normalizeQuoraProfileHref,
  normalizeTabTargetUrl: normalizeTabTargetUrl,
  sanitizeProfileHrefSlug: sanitizeProfileHrefSlug,
  stripDescriptiveProfileSuffix: stripDescriptiveProfileSuffix,
  stripTrailingProfileArtifactToken: stripTrailingProfileArtifactToken
};

/***/ }),

/***/ "./shared/js/swCoordinatorStatusRules.js":
/*!***********************************************!*\
  !*** ./shared/js/swCoordinatorStatusRules.js ***!
  \***********************************************/
/***/ ((module) => {

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
// Coordinator terminal/active/pending/retryable-status predicates extracted
// from sw.js (decomposition Slice 12, part 1 of 2). These six functions are
// the foundational status-classification leaves the whole reconcile core
// consults -- isTerminalCoordinatorStatus (132 external refs) and
// isActiveCoordinatorStatus (71 refs) in particular are used from nearly
// every reconcile decision point in the file.
//
// Split into its own module (rather than combined with the rest of Slice
// 12's cluster in swCoordinatorProgressRules.js) purely for TDZ construction-
// order reasons, matching the Slice 11 precedent (swCoordinatorAttemptIdentity.js
// / swCoordinatorJobEnvelope.js split): three already-extracted modules'
// construction call object literals reference isTerminalCoordinatorStatus
// and/or isCoordinatorQueueAuthoritativeItem and isActiveCoordinatorStatus
// eagerly at sw.js module-eval time, well before this cluster's old
// source-text position (~3941-4190):
//   - coordinatorAttemptIdentity (sw.js line ~571, the earliest) eagerly
//     references isCoordinatorQueueAuthoritativeItem and
//     isTerminalCoordinatorStatus.
//   - coordinatorJobEnvelope (line ~1324) eagerly references
//     isTerminalCoordinatorStatus.
//   - coordinatorReconcileInputs (line ~1451) eagerly references
//     isTerminalCoordinatorStatus and isActiveCoordinatorStatus.
//   - queuedTabRuntimeStatus (line ~1798) eagerly references
//     isActiveCoordinatorStatus.
// A hoisted `function` declaration is visible throughout its enclosing
// scope; a `const` destructured from a factory call is in the temporal dead
// zone until that line executes -- so this module must construct before all
// of those eager references, i.e. before coordinatorAttemptIdentity, the
// earliest one. These six predicates have no dependency on anything else in
// sw.js besides the already-required jobState.js exports, so they can
// construct anywhere before that point with no further ordering constraint.
//
// The rest of Slice 12's cluster (mergeCoordinatorSources through
// pruneCoordinatorCurrentWork) needs coordinatorAttemptIdentity's own
// exports (getAttemptIdFromValue/getAttemptNumberFromValue), so it cannot
// construct until after coordinatorAttemptIdentity exists -- the opposite
// constraint from this module. A single combined module would have had to
// satisfy both at once, which isn't possible without deferred-thunk tricks;
// see swCoordinatorProgressRules.js for that half.
//
// None of the six moved bodies read Date.now() or any other environment
// global, so this module needs no clock dependency.
//
// shouldResetCoordinatorItemForIncoming and shouldResetCoordinatorExecutor
// added in decomposition Slice 43 (mop-up of remaining isolated singles):
// both are enqueue-time "should this reset the existing item/executor"
// gates, and shouldResetCoordinatorItemForIncoming calls this module's own
// isRetryableCoordinatorFailure and isTerminalCoordinatorStatus internally
// (ordinary same-factory function calls, no dep threading needed) plus
// UNBLOCK_UNMUTE_ACTION_KIND (added as a constant, already available from
// the jobState.js require at the top of sw.js). shouldResetCoordinatorExecutor
// has no dependencies beyond its own parameters. Neither reads Date.now()
// or any other environment global, and neither has any async keyword or
// Promise/`.then()`/`.catch()` chain (grepped both bodies per architecture.md's
// realm-crossing note) -- no realm-crossing risk. Both had exactly one
// external reference each, called from deep inside resident async
// enqueue-path functions, so no eager construction-order concern either.

function createCoordinatorStatusRules() {
  var deps = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var _ref = deps.constants || {},
    UNBLOCK_UNMUTE_ACTION_KIND = _ref.UNBLOCK_UNMUTE_ACTION_KIND;
  var _ref2 = deps.handlers || {},
    isTerminalJobStatus = _ref2.isTerminalJobStatus,
    isRetryableJobFailure = _ref2.isRetryableJobFailure,
    isRetryableJobFailureFromProgress = _ref2.isRetryableJobFailureFromProgress;
  function isTerminalCoordinatorStatus(status) {
    return isTerminalJobStatus(status);
  }
  function isActiveCoordinatorStatus() {
    var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
    return ['opening', 'active', 'acting', 'settling'].includes("".concat(status || '').trim());
  }
  function isPendingCoordinatorStatus() {
    var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
    return status === 'queued' || isActiveCoordinatorStatus(status);
  }
  function isRetryableCoordinatorFailure() {
    var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
    return isRetryableJobFailure(item);
  }
  function isRetryableCoordinatorFailureFromProgress() {
    var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
    var record = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    return isRetryableJobFailureFromProgress(item, record);
  }
  function isCoordinatorQueueAuthoritativeItem() {
    var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
    return (item === null || item === void 0 ? void 0 : item.serviceWorkerOwned) === true || "".concat((item === null || item === void 0 ? void 0 : item.executorOwner) || '') === 'service-worker';
  }
  function shouldResetCoordinatorItemForIncoming() {
    var _rawItem$source;
    var existing = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
    var actionKind = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
    var rawItem = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    var runInput = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
    var source = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};
    if (!existing) return false;
    var explicitReset = (rawItem === null || rawItem === void 0 ? void 0 : rawItem.resetExisting) === true || (runInput === null || runInput === void 0 ? void 0 : runInput.resetExisting) === true || (source === null || source === void 0 ? void 0 : source.resetExisting) === true;
    if (explicitReset) return true;
    if (isRetryableCoordinatorFailure(existing)) return true;
    var terminalExisting = isTerminalCoordinatorStatus(existing === null || existing === void 0 ? void 0 : existing.status);
    if (!terminalExisting) return false;
    var sourceType = "".concat((rawItem === null || rawItem === void 0 || (_rawItem$source = rawItem.source) === null || _rawItem$source === void 0 ? void 0 : _rawItem$source.type) || (source === null || source === void 0 ? void 0 : source.type) || (runInput === null || runInput === void 0 ? void 0 : runInput.sourceType) || '').trim();
    return actionKind === UNBLOCK_UNMUTE_ACTION_KIND && sourceType === 'profile-reverse';
  }
  function shouldResetCoordinatorExecutor() {
    var request = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    var rawItems = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];
    var runInput = request.run && _typeof(request.run) === 'object' ? request.run : {};
    var source = request.source && _typeof(request.source) === 'object' ? request.source : {};
    return (runInput === null || runInput === void 0 ? void 0 : runInput.resetExisting) === true || (source === null || source === void 0 ? void 0 : source.resetExisting) === true || rawItems.some(function (item) {
      return (item === null || item === void 0 ? void 0 : item.resetExisting) === true;
    });
  }
  return {
    isTerminalCoordinatorStatus: isTerminalCoordinatorStatus,
    isActiveCoordinatorStatus: isActiveCoordinatorStatus,
    isPendingCoordinatorStatus: isPendingCoordinatorStatus,
    isRetryableCoordinatorFailure: isRetryableCoordinatorFailure,
    isRetryableCoordinatorFailureFromProgress: isRetryableCoordinatorFailureFromProgress,
    isCoordinatorQueueAuthoritativeItem: isCoordinatorQueueAuthoritativeItem,
    shouldResetCoordinatorItemForIncoming: shouldResetCoordinatorItemForIncoming,
    shouldResetCoordinatorExecutor: shouldResetCoordinatorExecutor
  };
}
module.exports = {
  createCoordinatorStatusRules: createCoordinatorStatusRules
};

/***/ }),

/***/ "./shared/js/timeouts.js":
/*!*******************************!*\
  !*** ./shared/js/timeouts.js ***!
  \*******************************/
/***/ ((module) => {

// Entropy-reduction Pattern 8 (see entropy-reduction-action-plan-2026-09-09.md
// and ../../memory project memory feedback-symbolic-timeout-registry): named
// homes for the timeout/interval values that used to live as bare numeric
// literals in each wait-loop function's own default parameters, scattered
// across content.js and coordinator.js with no shared vocabulary. Named per
// function (and, for coordinator.js's dashboard round trips, per message
// weight) rather than deduplicated by value -- two waits that happen to share
// a number today are not necessarily the same *kind* of wait, and giving them
// independent names keeps them independently tunable later.
//
// Scope note: this first pass covers each wait-loop function's own default
// parameter value -- the value every call site inherits unless it explicitly
// overrides it, so it's the one true "system-wide dial" per wait kind. The
// much larger set of explicit per-call-site overrides in content.js (dozens
// of one-off `waitFor*(..., customTimeoutMs, customIntervalMs)` calls) is
// left as scattered literals for now, migrated opportunistically as each is
// independently touched, per the same reactive policy that seeded this file
// in the first place.

module.exports = {
  // content.js wait-loop primitives (shared/js/content.js)
  WAIT_FOR_ACTION_DEFAULT_TIMEOUT_MS: 4000,
  WAIT_FOR_ACTION_DEFAULT_INTERVAL_MS: 200,
  WAIT_FOR_CONDITION_DEFAULT_TIMEOUT_MS: 4000,
  WAIT_FOR_CONDITION_DEFAULT_INTERVAL_MS: 200,
  WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_TIMEOUT_MS: 4000,
  WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_INTERVAL_MS: 250,
  // content.js profile-menu-state waits
  WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS: 5000,
  WAIT_FOR_MENU_STATE_DEFAULT_INTERVAL_MS: 250,
  READ_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS: 2500,
  READ_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS: 200,
  WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS: 8000,
  WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS: 500,
  ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS: 2500,
  // content.js action-verification waits
  WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_TIMEOUT_MS: 8000,
  WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_INTERVAL_MS: 250,
  WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_TIMEOUT_MS: 8000,
  WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_INTERVAL_MS: 250,
  WAIT_FOR_PROFILE_ACTION_READY_DEFAULT_TIMEOUT_MS: 5000,
  WAIT_FOR_CANONICAL_PROFILE_ACTION_ROUTE_DEFAULT_TIMEOUT_MS: 5000,
  WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS: 180000,
  WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_INTERVAL_MS: 1000,
  CLOSE_PROFILE_MENU_DEFAULT_TIMEOUT_MS: 1500,
  // content.js's own service-worker message round trip (parallel to
  // coordinator.js's sendRuntimeMessageWithTimeout below)
  SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS: 12000,
  // content.js space-feed batch enqueue (enqueueCoordinatorSpaceFeedItems):
  // a big enough batch, chunked against an already-large durable queue,
  // can legitimately outlive the service worker's own execution lifetime
  // -- the chunked write still completes and is durably summarized, but
  // the original sendMessage's response channel is gone, so the awaiting
  // page hangs forever on a response that will never arrive (confirmed
  // live 2026-09-19: a 657-candidate batch finished durably per
  // mbCoordinatorLastEnqueueSummary while the button stayed on "Nuking..."
  // indefinitely). MESSAGE_TIMEOUT_MS bounds how long to wait for the
  // direct response before falling back to polling that durable summary
  // by runId; SUMMARY_POLL_TIMEOUT_MS/INTERVAL_MS bound that fallback.
  SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS: 15000,
  SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS: 90000,
  SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS: 1000,
  // content.js chunk-level retry (sendCoordinatorEnqueueChunked): a chunk
  // that comes back with no response, a storage timeout, or durable:false
  // has not landed at all -- this write path has no partial-success state,
  // so re-sending the same chunk can never double-count. 2026-10-06: a
  // 491-candidate batch silently lost its last (32-item) chunk this way,
  // with the old break-on-first-failure loop reporting a numerically
  // "complete" summary that was actually short by 32 -- user explicitly
  // ruled out "ask the user to retry" as a fix, so failed chunks now retry
  // in place with backoff instead of abandoning the rest of the batch.
  SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS: 5,
  SPACE_FEED_ENQUEUE_CHUNK_RETRY_BASE_DELAY_MS: 2000,
  // coordinator.js dashboard-to-service-worker message round trips
  // (sendRuntimeMessageWithTimeout's own default, and the heavier
  // mutation-style calls that explicitly opt into a longer budget)
  COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS: 5000,
  COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS: 10000,
  // sw.js
  WAIT_FOR_USER_START_DURABLE_ACTIVATION_DEFAULT_TIMEOUT_MS: 15000,
  // sw.js stale-active-row watchdog (runCoordinatorReconcileTickOnce): a
  // durable row can sit at status 'active' indefinitely if the specific
  // combination of conditions that would normally classify and recover it
  // (classifyCoordinatorExecutorState's 'active-missing-tab' case, handled
  // in runCoordinatorExecutorApplyPhase) never gets reached -- that deep
  // classifier only runs when prunedQueuedActions > 0 this tick, which has
  // nothing to do with whether an unrelated active row's tab is actually
  // gone. Confirmed live 2026-10-06: one row sat 'active' for over an hour
  // with zero matching live tabs (getLiveProfileTabsByHref came back
  // empty for its href) while reconcile ticks kept running normally every
  // ~60s. This watchdog runs unconditionally on every reconcile tick
  // (cheap: the full queue is already loaded for the unrelated
  // queued-action prune step) and force-recovers any active row past this
  // age with no matching live tab, independent of that gate.
  STALE_ACTIVE_COORDINATOR_ROW_WATCHDOG_MS: 180000,
  // sw.js runCoordinatorQueueExecutorFastPath coalescing (2026-10-07): a
  // burst of distinct reactive triggers (slot-release, active-transition,
  // queued-authority-enqueue, etc.) can each independently call this
  // function within milliseconds of each other. Confirmed live: 13 such
  // calls back to back, each 45-72 real seconds (queued behind the same
  // serialized storage-update lane), with every call after the first
  // finding nothing left to do. This window bounds how recently the last
  // completed call must have finished -- and how little must have changed
  // since (compared via a cheap in-memory runtime/queue-counts fingerprint,
  // no storage I/O) -- for a new call to reuse that result instead of
  // repeating the full pass. Short enough that a call outside this window
  // is treated as a genuinely new situation, long enough to collapse a
  // same-moment burst of triggers into one real pass.
  COORDINATOR_FAST_EXECUTOR_RECENT_NOOP_COOLDOWN_MS: 2000
};

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
/*!**********************************!*\
  !*** ./shared/js/coordinator.js ***!
  \**********************************/
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
var browser = __webpack_require__(/*! webextension-polyfill */ "./node_modules/webextension-polyfill/dist/browser-polyfill.js");
var _require = __webpack_require__(/*! ./jobState */ "./shared/js/jobState.js"),
  isRetryableJobFailure = _require.isRetryableJobFailure,
  isRetryableJobFailureFromProgress = _require.isRetryableJobFailureFromProgress,
  isTerminalJobStatus = _require.isTerminalJobStatus,
  UNBLOCK_UNMUTE_ACTION_KIND = _require.UNBLOCK_UNMUTE_ACTION_KIND;
var _require2 = __webpack_require__(/*! ./swCoordinatorStatusRules */ "./shared/js/swCoordinatorStatusRules.js"),
  createCoordinatorStatusRules = _require2.createCoordinatorStatusRules;
var _require3 = __webpack_require__(/*! ./timeouts */ "./shared/js/timeouts.js"),
  COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS = _require3.COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS,
  COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS = _require3.COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS;
var _require4 = __webpack_require__(/*! ./nukedPosts */ "./shared/js/nukedPosts.js"),
  SPACE_NUKED_POSTS_KEY = _require4.SPACE_NUKED_POSTS_KEY,
  NUKED_POST_RETENTION_DAYS_KEY = _require4.NUKED_POST_RETENTION_DAYS_KEY,
  MAX_REMEMBERED_NUKED_POSTS_KEY = _require4.MAX_REMEMBERED_NUKED_POSTS_KEY,
  getPrunedNukedPosts = _require4.getPrunedNukedPosts;
var defaults = __webpack_require__(/*! ./defaults */ "./shared/js/defaults.js");

// coordinatorStatusRules is the same factory sw.js uses, so
// isTerminalQueueStatus/isActiveQueueItem/isPendingQueueStatus/
// isRetryableFailedQueueItem below delegate to it instead of maintaining
// their own copies of the status arrays (2026-09-10 entropy-reduction fix:
// this file's arrays had drifted -- isTerminalQueueStatus's ['succeeded',
// 'failed', 'skipped', 'canceled', 'complete'] included a dead 'complete'
// value no queue item status is ever actually set to; canonical
// TERMINAL_JOB_STATUSES in jobState.js has never included it).
var coordinatorStatusRules = createCoordinatorStatusRules({
  constants: {
    UNBLOCK_UNMUTE_ACTION_KIND: UNBLOCK_UNMUTE_ACTION_KIND
  },
  handlers: {
    isTerminalJobStatus: isTerminalJobStatus,
    isRetryableJobFailure: isRetryableJobFailure,
    isRetryableJobFailureFromProgress: isRetryableJobFailureFromProgress
  }
});
var isTerminalCoordinatorStatus = coordinatorStatusRules.isTerminalCoordinatorStatus,
  isActiveCoordinatorStatus = coordinatorStatusRules.isActiveCoordinatorStatus,
  isPendingCoordinatorStatus = coordinatorStatusRules.isPendingCoordinatorStatus,
  isRetryableCoordinatorFailure = coordinatorStatusRules.isRetryableCoordinatorFailure;
var COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView';
var COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns';
var COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents';
var QUEUE_WAKEUP_METRICS_VIEW_KEY = 'mbQueueWakeupMetricsView';
var LAST_ENQUEUE_SUMMARY_KEY = 'mbCoordinatorLastEnqueueSummary';
var LAST_ENQUEUE_SUMMARY_MAX_AGE_MS = 30 * 60 * 1000;
var SPACE_REGISTRY_KEY = 'mbSpaceRegistry';
var HIDDEN_RUNS_KEY = 'mbCoordinatorHiddenRunIds';
var COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled';
var COORDINATOR_PAUSED_KEY = 'mbCoordinatorPaused';
// Per-viewer UI preference only (like a collapsed panel), not durable
// coordinator state -- localStorage is the right home for it, same
// reasoning as dismissedOutlierKeys/eventHistogramClearedAtMs below, except
// this one is meant to survive a reload.
var DEV_MODE_STORAGE_KEY = 'mbDashboardDevMode';
// chrome.storage mirror of the above, readable by the service worker (see
// setDevModeStoredEnabled) -- must match sw.js's DEV_MODE_SYNC_STORAGE_KEY.
var DEV_MODE_SYNC_STORAGE_KEY = 'mbDashboardDevModeEnabled';
var QUEUED_ACTION_SURFACE_STATE_KEY = 'mbQueuedActionSurfaceState';
var QUEUED_ACTION_SURFACE_COORDINATOR_HASH = '#progress';
var COORDINATOR_HISTORY_HASH = '#history';
var DASHBOARD_COMPACT_REFRESH_INTERVAL_MS = 2000;
var DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS = 100;
var RETRY_FAILED_LIMIT = 2;
var SECONDS_PER_BLOCK_SAMPLE_LIMIT = 100;
// Mirrors swCoordinatorQueueView.js's COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS
// -- this client-side computation only runs when the SW-provided view value
// is missing, but should apply the same outlier protection when it does.
var TIMING_SAMPLE_MAX_PLAUSIBLE_MS = 1800000;
var CURRENT_WORK_MUTATION_TIMEOUT_MS = 70000;
// Outlier detection: a row's active-duration (queue -> tab -> block, live
// for rows still running) is flagged if it exceeds a flat floor OR is a
// genuine statistical outlier for this session (mean + N standard
// deviations over already-terminal rows) -- the floor alone would miss a
// session that's uniformly slow in a way still worth flagging relative to
// itself, and the stddev alone would never fire early before enough
// terminal samples exist. Checked on every render pass against every row
// (active or terminal), not just at completion, so a row that's stuck and
// never finishes still gets caught. Deliberately not persisted anywhere --
// in-memory dashboard state only, reset on page reload, manually clearable.
var COORDINATOR_OUTLIER_ABSOLUTE_THRESHOLD_MS = 45000;
var COORDINATOR_OUTLIER_STDDEV_MULTIPLIER = 2.5;
var COORDINATOR_OUTLIER_MIN_SAMPLES_FOR_STDDEV = 5;
var COORDINATOR_OUTLIER_MAX_ENTRIES = 50;
var state = {
  queue: {},
  queueView: {},
  queueCounts: {},
  queueTotal: 0,
  queueTruncated: false,
  runs: {},
  events: [],
  metrics: {},
  spaceRegistry: {},
  hiddenRunIds: [],
  paused: false,
  loading: true,
  loadError: '',
  requiresQuoraVisit: false,
  requiresQuoraVisitAt: 0,
  quoraActivationCounterBaseline: 0,
  quoraActivationMetricBaselineKnown: false,
  outliers: [],
  lastEnqueueSummary: null
};
// Keyed by rowKey+attemptId, separate from state.outliers: a terminal row's
// duration never changes, so without this a manually-cleared outlier would
// simply get re-detected and reappear on the very next refresh pass. Clearing
// dismisses that specific attempt permanently for this dashboard session
// (not persisted, same as everything else here) -- a new attempt (retry) or
// a different row is unaffected.
var dismissedOutlierKeys = new Set();
// Recent event counts (renderEventHistogram) re-fetches and re-tallies the
// flight recorder's full retained window on every render, so a client-only
// "clear" can't remove entries -- they'd just reappear on the next refresh.
// Instead this records when Clear was pressed and every render only tallies
// entries recorded after it, the same "not persisted, this tab only" scope
// as dismissedOutlierKeys above. The flight recorder itself is a read-only
// diagnostic journal (swflightRecorder.js) with no production reset action,
// and this doesn't add one.
var eventHistogramClearedAtMs = 0;
// Track the previous "Progress events" pending-max reading for trend
// coloring on that metric card (renderWakeupMetrics) -- null until the
// first refresh has run.
var previousProgressPendingMax = null;
var dashboardCompactRefreshTimer = null;
var dashboardCompactRefreshScheduledTimer = null;
var dashboardCompactRefreshPromise = null;
var retryFailedActive = false;
var retryFailedLastResult = null;
var currentWorkPausePending = '';
addEventListener('load', function () {
  void init();
});

// A hash-only navigation (e.g. the service worker reusing this exact tab
// but switching it from #history to the plain dashboard, or vice versa) is
// a same-document navigation -- it never fires 'load' and re-runs init(),
// so the previous view's content and click handlers would otherwise just
// stay put while the address bar quietly changed underneath them.
// Confirmed live 2026-09-29: reusing a tab across views left the wrong
// section(s) visible. Reloading is simpler and safer than trying to
// re-run init() in place (which would double-register every click handler
// the previous view's init() already attached).
addEventListener('hashchange', function () {
  location.reload();
});
function openCoordinatorViewFromHere() {
  return _openCoordinatorViewFromHere.apply(this, arguments);
}
function _openCoordinatorViewFromHere() {
  _openCoordinatorViewFromHere = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee() {
    var action,
      currentWindow,
      _args = arguments;
    return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          action = _args.length > 0 && _args[0] !== undefined ? _args[0] : 'open-coordinator';
          _context.next = 3;
          return browser.windows.getCurrent()["catch"](function () {
            return null;
          });
        case 3:
          currentWindow = _context.sent;
          _context.next = 6;
          return sendRuntimeMessageWithTimeout({
            action: action,
            active: true,
            windowId: (currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.id) || null
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)["catch"](function () {
            return null;
          });
        case 6:
        case "end":
          return _context.stop();
      }
    }, _callee);
  }));
  return _openCoordinatorViewFromHere.apply(this, arguments);
}
function loadHistoryEntries() {
  return _loadHistoryEntries.apply(this, arguments);
}
function _loadHistoryEntries() {
  _loadHistoryEntries = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
    var stored;
    return _regeneratorRuntime().wrap(function _callee2$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return browser.storage.local.get(_defineProperty(_defineProperty(_defineProperty({}, SPACE_NUKED_POSTS_KEY, {}), NUKED_POST_RETENTION_DAYS_KEY, defaults[NUKED_POST_RETENTION_DAYS_KEY]), MAX_REMEMBERED_NUKED_POSTS_KEY, defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]));
        case 2:
          stored = _context2.sent;
          return _context2.abrupt("return", getPrunedNukedPosts(stored[SPACE_NUKED_POSTS_KEY] || {}, {
            retentionDays: stored[NUKED_POST_RETENTION_DAYS_KEY],
            maxEntries: stored[MAX_REMEMBERED_NUKED_POSTS_KEY]
          }));
        case 4:
        case "end":
          return _context2.stop();
      }
    }, _callee2);
  }));
  return _loadHistoryEntries.apply(this, arguments);
}
function renderHistoryList() {
  return _renderHistoryList.apply(this, arguments);
}
function _renderHistoryList() {
  _renderHistoryList = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee3() {
    var entries, rows, countEl, list;
    return _regeneratorRuntime().wrap(function _callee3$(_context3) {
      while (1) switch (_context3.prev = _context3.next) {
        case 0:
          _context3.next = 2;
          return loadHistoryEntries();
        case 2:
          entries = _context3.sent;
          rows = Object.entries(entries);
          countEl = document.getElementById('historyCount');
          if (countEl) countEl.textContent = "".concat(rows.length, " ").concat(rows.length === 1 ? 'entry' : 'entries');
          list = document.getElementById('historyList');
          if (list) {
            _context3.next = 9;
            break;
          }
          return _context3.abrupt("return");
        case 9:
          replaceChildren(list, rows.map(function (_ref31) {
            var _ref32 = _slicedToArray(_ref31, 2),
              postKey = _ref32[0],
              record = _ref32[1];
            var urls = Array.isArray(record === null || record === void 0 ? void 0 : record.urls) ? record.urls : [];
            var singleProfileHref = urls.length === 1 ? urls[0] : '';
            var profileLabel = singleProfileHref ? getProfileLabelFromHref(singleProfileHref) : '';
            // Matches renderQueue's own title/subtitle pattern (Current Work
            // listing): title links to the actual profile, subtitle is the
            // action mode plus the source it came from -- SPACE_NUKED_POSTS_KEY
            // entries are always mute-block (there's no unblock/unmute
            // equivalent of a space-feed post nuke), so that half is constant.
            var titleLabel = profileLabel || (urls.length > 1 ? "".concat(urls.length, " profiles") : postKey || 'Unknown profile');
            var titleHref = singleProfileHref || '';
            var sourceLabel = getSourceLabelFromUrl((record === null || record === void 0 ? void 0 : record.postUrl) || (record === null || record === void 0 ? void 0 : record.spaceUrl) || '');
            var when = record !== null && record !== void 0 && record.updatedAt ? formatDateTime(record.updatedAt) : '';
            var subtitle = ['Mute Block', sourceLabel, when].filter(Boolean).join(' • ');
            var row = document.createElement('div');
            row.className = 'row';
            row.append(buildTitleCell(titleLabel, subtitle, {
              titleHref: titleHref,
              subtitleHref: (record === null || record === void 0 ? void 0 : record.postUrl) || ''
            }));
            return row;
          }), 'No history yet.');
        case 10:
        case "end":
          return _context3.stop();
      }
    }, _callee3);
  }));
  return _renderHistoryList.apply(this, arguments);
}
function clearHistory() {
  return _clearHistory.apply(this, arguments);
} // The three coordinator.html views (default dashboard, #progress,
// #history) each render their own content correctly for their mode, but
// nothing ever toggled which container is actually visible -- all three
// sections stayed shown simultaneously regardless of hash. Confirmed live
// 2026-09-29 (screenshot): the worker bar and the history header both
// rendered stacked on top of the plain dashboard.
function _clearHistory() {
  _clearHistory = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee4() {
    return _regeneratorRuntime().wrap(function _callee4$(_context4) {
      while (1) switch (_context4.prev = _context4.next) {
        case 0:
          if (window.confirm('Clear all Recent History?')) {
            _context4.next = 2;
            break;
          }
          return _context4.abrupt("return");
        case 2:
          _context4.next = 4;
          return browser.storage.local.set(_defineProperty({}, SPACE_NUKED_POSTS_KEY, {}));
        case 4:
          _context4.next = 6;
          return renderHistoryList();
        case 6:
        case "end":
          return _context4.stop();
      }
    }, _callee4);
  }));
  return _clearHistory.apply(this, arguments);
}
function applyCoordinatorViewMode() {
  var dashboardView = document.getElementById('dashboardView');
  var workerBarView = document.getElementById('workerBarView');
  var historyView = document.getElementById('historyView');
  var dashboardBottomBar = document.getElementById('dashboardBottomBar');
  var isWorkerBar = isQueuedWorkerActionSurfacePage();
  var isHistory = isCoordinatorHistoryPage();
  if (dashboardView) dashboardView.hidden = isWorkerBar || isHistory;
  if (workerBarView) workerBarView.hidden = !isWorkerBar;
  if (historyView) historyView.hidden = !isHistory;
  // Only the plain dashboard gets the footer bar -- the worker window has
  // its own equivalent (.worker-bar) and History is just a short list.
  if (dashboardBottomBar) dashboardBottomBar.hidden = isWorkerBar || isHistory;
}
function initHistoryPage() {
  return _initHistoryPage.apply(this, arguments);
}
function _initHistoryPage() {
  _initHistoryPage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
    var _document$getElementB, _document$getElementB2, _document$getElementB3;
    return _regeneratorRuntime().wrap(function _callee5$(_context5) {
      while (1) switch (_context5.prev = _context5.next) {
        case 0:
          document.title = 'History';
          (_document$getElementB = document.getElementById('clearHistoryButton')) === null || _document$getElementB === void 0 || _document$getElementB.addEventListener('click', function () {
            void clearHistory();
          });
          (_document$getElementB2 = document.getElementById('historyDashboardButton')) === null || _document$getElementB2 === void 0 || _document$getElementB2.addEventListener('click', function () {
            void openCoordinatorViewFromHere('open-coordinator');
          });
          (_document$getElementB3 = document.getElementById('historyPreferencesButton')) === null || _document$getElementB3 === void 0 || _document$getElementB3.addEventListener('click', function () {
            void openPreferences();
          });
          // Deliberately no broad storage-change listener here -- this file
          // avoids that delivery mechanism on purpose elsewhere (see "dashboard
          // live refresh avoids broad storage change delivery"). This page only
          // ever changes via its own Clear button, which already re-renders
          // itself, so a one-time load on open is enough.
          _context5.next = 6;
          return renderHistoryList();
        case 6:
        case "end":
          return _context5.stop();
      }
    }, _callee5);
  }));
  return _initHistoryPage.apply(this, arguments);
}
function initWorkerBarPage() {
  return _initWorkerBarPage.apply(this, arguments);
}
function _initWorkerBarPage() {
  _initWorkerBarPage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
    var _document$getElementB4, _document$getElementB5, _document$getElementB6, _document$getElementB7, _document$getElementB8;
    var manifest, versionEl;
    return _regeneratorRuntime().wrap(function _callee6$(_context6) {
      while (1) switch (_context6.prev = _context6.next) {
        case 0:
          _context6.next = 2;
          return registerQueuedWorkerActionSurfacePage();
        case 2:
          manifest = browser.runtime.getManifest();
          versionEl = document.getElementById('workerBarVersion');
          if (versionEl) versionEl.textContent = "v".concat(manifest.version);
          (_document$getElementB4 = document.getElementById('workerBarPauseResume')) === null || _document$getElementB4 === void 0 || _document$getElementB4.addEventListener('click', function () {
            void toggleCurrentWorkPause();
          });
          (_document$getElementB5 = document.getElementById('workerBarCancel')) === null || _document$getElementB5 === void 0 || _document$getElementB5.addEventListener('click', function () {
            void cancelCurrentWork();
          });
          (_document$getElementB6 = document.getElementById('workerBarDashboard')) === null || _document$getElementB6 === void 0 || _document$getElementB6.addEventListener('click', function () {
            void openCoordinatorViewFromHere('open-coordinator');
          });
          (_document$getElementB7 = document.getElementById('workerBarHistory')) === null || _document$getElementB7 === void 0 || _document$getElementB7.addEventListener('click', function () {
            void openCoordinatorViewFromHere('open-coordinator-history');
          });
          (_document$getElementB8 = document.getElementById('workerBarPreferences')) === null || _document$getElementB8 === void 0 || _document$getElementB8.addEventListener('click', function () {
            void openPreferences();
          });
          installCompactStorageRefreshPolling();
          installDashboardRuntimeRefreshListener();
          render();
          _context6.next = 15;
          return announceCoordinatorPageReady();
        case 15:
          _context6.prev = 15;
          _context6.next = 18;
          return loadState();
        case 18:
          _context6.next = 22;
          break;
        case 20:
          _context6.prev = 20;
          _context6.t0 = _context6["catch"](15);
        case 22:
          render();
        case 23:
        case "end":
          return _context6.stop();
      }
    }, _callee6, null, [[15, 20]]);
  }));
  return _initWorkerBarPage.apply(this, arguments);
}
function init() {
  return _init.apply(this, arguments);
}
function _init() {
  _init = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee7() {
    var _document$getElementB9, _document$getElementB10, _document$getElementB11, _document$getElementB12, _document$getElementB13, _document$getElementB14, _document$getElementB15, _document$getElementB16, _document$getElementB17, _document$getElementB18, _document$getElementB19, _document$getElementB20, _document$getElementB21, _document$getElementB22, _document$getElementB23, _document$getElementB24, _document$getElementB25, _document$getElementB26;
    var manifest, ready;
    return _regeneratorRuntime().wrap(function _callee7$(_context7) {
      while (1) switch (_context7.prev = _context7.next) {
        case 0:
          applyCoordinatorViewMode();
          if (!isCoordinatorHistoryPage()) {
            _context7.next = 5;
            break;
          }
          _context7.next = 4;
          return initHistoryPage();
        case 4:
          return _context7.abrupt("return");
        case 5:
          if (!isQueuedWorkerActionSurfacePage()) {
            _context7.next = 9;
            break;
          }
          _context7.next = 8;
          return initWorkerBarPage();
        case 8:
          return _context7.abrupt("return");
        case 9:
          manifest = browser.runtime.getManifest();
          document.getElementById('appVersion').textContent = "v".concat(manifest.version);
          (_document$getElementB9 = document.getElementById('dashboardBottomBarLogo')) === null || _document$getElementB9 === void 0 || _document$getElementB9.addEventListener('click', function () {
            void openDashboardFromBottomBar();
          });
          (_document$getElementB10 = document.getElementById('clearEventsButton')) === null || _document$getElementB10 === void 0 || _document$getElementB10.addEventListener('click', function () {
            void clearEvents();
          });
          (_document$getElementB11 = document.getElementById('clearCompletedRunsButton')) === null || _document$getElementB11 === void 0 || _document$getElementB11.addEventListener('click', function () {
            void clearCompletedRuns();
          });
          (_document$getElementB12 = document.getElementById('clearOutliersButton')) === null || _document$getElementB12 === void 0 || _document$getElementB12.addEventListener('click', function () {
            clearOutliers();
          });
          (_document$getElementB13 = document.getElementById('clearScanCostButton')) === null || _document$getElementB13 === void 0 || _document$getElementB13.addEventListener('click', function () {
            void resetMetrics();
          });
          (_document$getElementB14 = document.getElementById('clearAuthorityLoadHistogramButton')) === null || _document$getElementB14 === void 0 || _document$getElementB14.addEventListener('click', function () {
            void resetMetrics();
          });
          (_document$getElementB15 = document.getElementById('resetPhaseTimingButton')) === null || _document$getElementB15 === void 0 || _document$getElementB15.addEventListener('click', function () {
            void resetMetrics();
          });
          (_document$getElementB16 = document.getElementById('clearEventHistogramButton')) === null || _document$getElementB16 === void 0 || _document$getElementB16.addEventListener('click', function () {
            clearEventHistogram();
          });
          (_document$getElementB17 = document.getElementById('resetMetricsButton')) === null || _document$getElementB17 === void 0 || _document$getElementB17.addEventListener('click', function () {
            void resetMetrics();
          });
          (_document$getElementB18 = document.getElementById('clearAllStatsButton')) === null || _document$getElementB18 === void 0 || _document$getElementB18.addEventListener('click', function () {
            void clearAllStats();
          });
          (_document$getElementB19 = document.getElementById('retryFailedButton')) === null || _document$getElementB19 === void 0 || _document$getElementB19.addEventListener('click', function () {
            void toggleRetryFailed();
          });
          (_document$getElementB20 = document.getElementById('requeueFailedButton')) === null || _document$getElementB20 === void 0 || _document$getElementB20.addEventListener('click', function () {
            void requeueFailed();
          });
          (_document$getElementB21 = document.getElementById('pauseCurrentWorkButton')) === null || _document$getElementB21 === void 0 || _document$getElementB21.addEventListener('click', function () {
            void toggleCurrentWorkPause();
          });
          (_document$getElementB22 = document.getElementById('cancelCurrentWorkButton')) === null || _document$getElementB22 === void 0 || _document$getElementB22.addEventListener('click', function () {
            void cancelCurrentWork();
          });
          (_document$getElementB23 = document.getElementById('clearCurrentWorkButton')) === null || _document$getElementB23 === void 0 || _document$getElementB23.addEventListener('click', function () {
            void clearCurrentWork();
          });
          (_document$getElementB24 = document.getElementById('startCoordinatorButton')) === null || _document$getElementB24 === void 0 || _document$getElementB24.addEventListener('click', function () {
            void startCoordinatorQueue();
          });
          (_document$getElementB25 = document.getElementById('openPreferencesButton')) === null || _document$getElementB25 === void 0 || _document$getElementB25.addEventListener('click', function () {
            void openPreferences();
          });
          (_document$getElementB26 = document.getElementById('openHistoryButton')) === null || _document$getElementB26 === void 0 || _document$getElementB26.addEventListener('click', function () {
            void openCoordinatorViewFromHere('open-coordinator-history');
          });
          installPanelToggleListeners();
          installPanelWheelScrollListeners();
          installDashboardRuntimeRefreshListener();
          installDevModeToggle();
          installCompactStorageRefreshPolling();
          render();
          _context7.next = 37;
          return announceCoordinatorPageReady();
        case 37:
          ready = _context7.sent;
          setQuoraVisitRequirement(!ready || !!(ready !== null && ready !== void 0 && ready.requiresQuoraVisit));
          _context7.prev = 39;
          _context7.next = 42;
          return loadState();
        case 42:
          captureQuoraActivationMetricBaseline();
          state.loadError = '';
          _context7.next = 49;
          break;
        case 46:
          _context7.prev = 46;
          _context7.t0 = _context7["catch"](39);
          state.loadError = (_context7.t0 === null || _context7.t0 === void 0 ? void 0 : _context7.t0.message) || "".concat(_context7.t0 || '') || 'Dashboard storage load failed';
        case 49:
          state.loading = false;
          if (retryFailedActive && !retryFailedLastResult) {
            retryFailedLastResult = {
              reason: 'resumed'
            };
          }
          render();
        case 52:
        case "end":
          return _context7.stop();
      }
    }, _callee7, null, [[39, 46]]);
  }));
  return _init.apply(this, arguments);
}
function isQueuedWorkerActionSurfacePage() {
  var _globalThis$location;
  return "".concat(((_globalThis$location = globalThis.location) === null || _globalThis$location === void 0 ? void 0 : _globalThis$location.hash) || '') === QUEUED_ACTION_SURFACE_COORDINATOR_HASH;
}
function isCoordinatorHistoryPage() {
  var _globalThis$location2;
  return "".concat(((_globalThis$location2 = globalThis.location) === null || _globalThis$location2 === void 0 ? void 0 : _globalThis$location2.hash) || '') === COORDINATOR_HISTORY_HASH;
}
function registerQueuedWorkerActionSurfacePage() {
  return _registerQueuedWorkerActionSurfacePage.apply(this, arguments);
} // 2026-09-27: this periodic poll used to run unconditionally every
// DASHBOARD_COMPACT_REFRESH_INTERVAL_MS (2s) for as long as the dashboard
// tab stayed open, regardless of whether the queue could possibly have
// changed. Confirmed live via the flight recorder: with the queue paused
// (or simply with nothing pending) and the dashboard left open, this alone
// produced thousands of no-op round-trips to the service worker over a
// few hours -- each one a real (if now skipped, see
// refreshCoordinatorQueueViewForDashboard) storage-update cycle, and each
// one inflating storageUpdate.noDurableWork (the "No-work writes" card)
// for reasons that had nothing to do with the queue actually stalling.
// Paused, or genuinely nothing pending, means nothing this timer tick
// could discover will have changed since the last one -- a real change
// (resume, new work enqueued, pause toggled elsewhere) already reaches
// this dashboard via installDashboardRuntimeRefreshListener's
// coordinator-dashboard-state-changed push, independent of this timer.
function _registerQueuedWorkerActionSurfacePage() {
  _registerQueuedWorkerActionSurfacePage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee8() {
    var _browser$storage, _browser$tabs, _browser$tabs$getCurr, _browser$windows, _currentWindow$tabs$f, _currentWindow$tabs$f2, _browser$storage2;
    var currentTab, currentWindow, windowId, anchorTabId;
    return _regeneratorRuntime().wrap(function _callee8$(_context8) {
      while (1) switch (_context8.prev = _context8.next) {
        case 0:
          if (isQueuedWorkerActionSurfacePage()) {
            _context8.next = 2;
            break;
          }
          return _context8.abrupt("return", false);
        case 2:
          if (((_browser$storage = browser.storage) === null || _browser$storage === void 0 || (_browser$storage = _browser$storage.session) === null || _browser$storage === void 0 ? void 0 : _browser$storage.set) !== undefined) {
            document.title = 'Progress';
          }
          _context8.next = 5;
          return (_browser$tabs = browser.tabs) === null || _browser$tabs === void 0 || (_browser$tabs$getCurr = _browser$tabs.getCurrent) === null || _browser$tabs$getCurr === void 0 ? void 0 : _browser$tabs$getCurr.call(_browser$tabs)["catch"](function () {
            return null;
          });
        case 5:
          currentTab = _context8.sent;
          if (!(!(currentTab !== null && currentTab !== void 0 && currentTab.windowId) && (_browser$windows = browser.windows) !== null && _browser$windows !== void 0 && _browser$windows.getCurrent)) {
            _context8.next = 12;
            break;
          }
          _context8.next = 9;
          return browser.windows.getCurrent({
            populate: true
          })["catch"](function () {
            return null;
          });
        case 9:
          _context8.t0 = _context8.sent;
          _context8.next = 13;
          break;
        case 12:
          _context8.t0 = null;
        case 13:
          currentWindow = _context8.t0;
          windowId = Number.parseInt((currentTab === null || currentTab === void 0 ? void 0 : currentTab.windowId) || (currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.id), 10) || 0;
          anchorTabId = Number.parseInt(currentTab === null || currentTab === void 0 ? void 0 : currentTab.id, 10) || (Array.isArray(currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.tabs) ? Number.parseInt(((_currentWindow$tabs$f = currentWindow.tabs.find(function (tab) {
            return tab === null || tab === void 0 ? void 0 : tab.active;
          })) === null || _currentWindow$tabs$f === void 0 ? void 0 : _currentWindow$tabs$f.id) || ((_currentWindow$tabs$f2 = currentWindow.tabs.find(function (tab) {
            return tab === null || tab === void 0 ? void 0 : tab.id;
          })) === null || _currentWindow$tabs$f2 === void 0 ? void 0 : _currentWindow$tabs$f2.id), 10) || 0 : 0);
          if (!(!windowId || !((_browser$storage2 = browser.storage) !== null && _browser$storage2 !== void 0 && (_browser$storage2 = _browser$storage2.session) !== null && _browser$storage2 !== void 0 && _browser$storage2.set))) {
            _context8.next = 18;
            break;
          }
          return _context8.abrupt("return", false);
        case 18:
          _context8.next = 20;
          return browser.storage.session.set(_defineProperty({}, QUEUED_ACTION_SURFACE_STATE_KEY, {
            windowId: windowId,
            anchorTabId: anchorTabId || null,
            url: browser.runtime.getURL("coordinator.html".concat(QUEUED_ACTION_SURFACE_COORDINATOR_HASH)),
            reason: 'coordinator-worker-window-load',
            updatedAt: Date.now()
          }))["catch"](function () {
            return null;
          });
        case 20:
          return _context8.abrupt("return", true);
        case 21:
        case "end":
          return _context8.stop();
      }
    }, _callee8);
  }));
  return _registerQueuedWorkerActionSurfacePage.apply(this, arguments);
}
var PENDING_QUEUE_VIEW_STATUSES = ['queued', 'opening', 'active', 'acting', 'settling'];
function isDashboardQueueDefinitelyIdle() {
  var _state$queueView;
  if (state.paused) return true;
  var counts = ((_state$queueView = state.queueView) === null || _state$queueView === void 0 ? void 0 : _state$queueView.counts) || {};
  return !PENDING_QUEUE_VIEW_STATUSES.some(function (status) {
    return (Number(counts[status]) || 0) > 0;
  });
}
function installCompactStorageRefreshPolling() {
  if (dashboardCompactRefreshTimer) return;
  addEventListener('pagehide', stopCompactStorageRefreshPolling);
  addEventListener('beforeunload', stopCompactStorageRefreshPolling);
  dashboardCompactRefreshTimer = setInterval(function () {
    if (isDashboardQueueDefinitelyIdle()) return;
    scheduleDashboardCompactRefresh();
  }, DASHBOARD_COMPACT_REFRESH_INTERVAL_MS);
}
function stopCompactStorageRefreshPolling() {
  if (!dashboardCompactRefreshTimer) return;
  clearInterval(dashboardCompactRefreshTimer);
  dashboardCompactRefreshTimer = null;
  if (dashboardCompactRefreshScheduledTimer) {
    clearTimeout(dashboardCompactRefreshScheduledTimer);
    dashboardCompactRefreshScheduledTimer = null;
  }
}

// 2026-09-30: this used to treat the broadcast as a bare "something
// changed, go re-read storage" signal -- which meant every push triggered a
// full loadState() (an 8-key browser.storage.local.get plus a
// refresh-coordinator-runs-view round trip) just to learn a value the
// service worker already had in hand at the moment it sent the message
// (see notifyCoordinatorDashboardStateChanged's own comment). Applying
// message.state directly here, when present, updates the counts the
// worker bar/dashboard-bottom-bar/summary tiles read (getQueueStatusCount,
// getQueueTotalCount, getQueueTerminalCount all prefer state.queueCounts/
// state.queueTotal once hasCoordinatorQueueView() is true) without any
// storage round trip at all. Deliberately NOT touched here: state.queue
// (the Current Work row list) -- this per-write view is the cheap,
// unmerged one built straight from the live authority queue, missing
// rows that already archived out from a *previous* transition, and
// applyCoordinatorQueueView would overwrite the row list with that
// incomplete set. The counts/total themselves are guarded by the
// isRegression check below instead: a hot-path mutation's own unmerged
// rebuild can under-report relative to what this page already has on
// screen (missing rows that already archived out in a *previous*
// transition), so a pushed value is only applied when it doesn't regress
// below what's already displayed. The periodic compact-storage poll below still runs
// as a slower-cadence correctness net that also refreshes the row list,
// runs, and metrics -- this is a fast path layered on top of it, not a
// replacement for it.
function sumTerminalQueueCounts() {
  var counts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Object.entries(counts || {}).filter(function (_ref) {
    var _ref2 = _slicedToArray(_ref, 1),
      status = _ref2[0];
    return isTerminalQueueStatus(status);
  }).reduce(function (total, _ref3) {
    var _ref4 = _slicedToArray(_ref3, 2),
      count = _ref4[1];
    return total + (Number.parseInt(count, 10) || 0);
  }, 0);
}
function applyCoordinatorDashboardStateFromMessage() {
  var incomingState = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var applied = false;
  if (Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_QUEUE_VIEW_KEY)) {
    var view = incomingState[COORDINATOR_QUEUE_VIEW_KEY];
    // 2026-10-01: mbCoordinatorQueueView is never persisted to disk (see
    // refreshCoordinatorQueueViewForDashboard's own comment in sw.js) --
    // every hot-path mutation broadcasts its own unmerged rebuild (built
    // straight from the live authority queue, no completed-rows merge),
    // which can be a dramatic undercount for a batch that's already
    // archived hundreds of rows into the completed-work log -- confirmed
    // live (jumped 419/676 -> 10/290 -> back, before this guard existed).
    // Never let a pushed total or terminal count regress below what this
    // page already has on screen. A real decrease (cancel/clear) goes
    // through its own explicit loadState()+render() after the action
    // completes, not through this push path, so this guard can't block
    // it.
    var incomingTotal = Number.parseInt(view === null || view === void 0 ? void 0 : view.total, 10) || 0;
    var incomingTerminal = sumTerminalQueueCounts(view === null || view === void 0 ? void 0 : view.counts);
    var currentTerminal = sumTerminalQueueCounts(state.queueCounts);
    var isRegression = hasCoordinatorQueueView() && (incomingTotal < state.queueTotal || incomingTerminal < currentTerminal);
    if (hasCoordinatorQueueView() && view && _typeof(view) === 'object' && !isRegression) {
      state.queueCounts = normalizeObject(view.counts);
      state.queueTotal = incomingTotal || state.queueTotal;
      applied = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_PAUSED_KEY)) {
    state.paused = incomingState[COORDINATOR_PAUSED_KEY] === true;
    applied = true;
  }
  if (Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_RETRY_FAILED_ENABLED_KEY)) {
    retryFailedActive = incomingState[COORDINATOR_RETRY_FAILED_ENABLED_KEY] === true;
    applied = true;
  }
  if (applied) render();
  return applied;
}
function installDashboardRuntimeRefreshListener() {
  var _browser$runtime;
  if (!((_browser$runtime = browser.runtime) !== null && _browser$runtime !== void 0 && (_browser$runtime = _browser$runtime.onMessage) !== null && _browser$runtime !== void 0 && _browser$runtime.addListener)) return;
  browser.runtime.onMessage.addListener(function (message) {
    if ("".concat((message === null || message === void 0 ? void 0 : message.action) || '') !== 'coordinator-dashboard-state-changed') return;
    if (applyCoordinatorDashboardStateFromMessage((message === null || message === void 0 ? void 0 : message.state) || {})) return;
    scheduleDashboardCompactRefresh(DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS);
  });
}
function scheduleDashboardCompactRefresh() {
  var delay = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  if (dashboardCompactRefreshScheduledTimer) return;
  dashboardCompactRefreshScheduledTimer = setTimeout(function () {
    dashboardCompactRefreshScheduledTimer = null;
    void refreshDashboardStateFromCompactStorage();
  }, Math.max(0, Number.parseInt(delay, 10) || 0));
}
function refreshDashboardStateFromCompactStorage() {
  return _refreshDashboardStateFromCompactStorage.apply(this, arguments);
}
function _refreshDashboardStateFromCompactStorage() {
  _refreshDashboardStateFromCompactStorage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee9() {
    return _regeneratorRuntime().wrap(function _callee9$(_context9) {
      while (1) switch (_context9.prev = _context9.next) {
        case 0:
          if (!state.loading) {
            _context9.next = 2;
            break;
          }
          return _context9.abrupt("return", false);
        case 2:
          if (!dashboardCompactRefreshPromise) {
            _context9.next = 4;
            break;
          }
          return _context9.abrupt("return", dashboardCompactRefreshPromise);
        case 4:
          dashboardCompactRefreshPromise = loadState().then(function () {
            state.loadError = '';
            render();
            return true;
          })["catch"](function (error) {
            state.loadError = (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '') || 'Dashboard storage refresh failed';
            render();
            return false;
          })["finally"](function () {
            dashboardCompactRefreshPromise = null;
          });
          return _context9.abrupt("return", dashboardCompactRefreshPromise);
        case 6:
        case "end":
          return _context9.stop();
      }
    }, _callee9);
  }));
  return _refreshDashboardStateFromCompactStorage.apply(this, arguments);
}
function sendRuntimeMessageWithTimeout(_x) {
  return _sendRuntimeMessageWithTimeout.apply(this, arguments);
}
function _sendRuntimeMessageWithTimeout() {
  _sendRuntimeMessageWithTimeout = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee10(message) {
    var fallback,
      timeoutMs,
      timeoutMarker,
      timeout,
      result,
      _args10 = arguments;
    return _regeneratorRuntime().wrap(function _callee10$(_context10) {
      while (1) switch (_context10.prev = _context10.next) {
        case 0:
          fallback = _args10.length > 1 && _args10[1] !== undefined ? _args10[1] : null;
          timeoutMs = _args10.length > 2 && _args10[2] !== undefined ? _args10[2] : COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS;
          timeoutMarker = {
            timedOut: true
          };
          timeout = new Promise(function (resolve) {
            return setTimeout(function () {
              return resolve(timeoutMarker);
            }, timeoutMs);
          });
          _context10.next = 6;
          return Promise.race([browser.runtime.sendMessage(message), timeout]);
        case 6:
          result = _context10.sent;
          return _context10.abrupt("return", result === timeoutMarker ? fallback : result);
        case 8:
        case "end":
          return _context10.stop();
      }
    }, _callee10);
  }));
  return _sendRuntimeMessageWithTimeout.apply(this, arguments);
}
function isDevModeStoredEnabled() {
  try {
    return localStorage.getItem(DEV_MODE_STORAGE_KEY) === '1';
  } catch (_unused) {
    return false;
  }
}
function setDevModeStoredEnabled(enabled) {
  try {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch (_unused2) {}
  // localStorage is dashboard-page-local -- the service worker (which is
  // what actually decides whether to write the pause diagnostic snapshot)
  // can't read it, so mirror the flag into chrome.storage as well.
  try {
    browser.storage.local.set(_defineProperty({}, DEV_MODE_SYNC_STORAGE_KEY, !!enabled))["catch"](function () {});
  } catch (_unused3) {}
}

// Diagnostic panels (Metrics, Scan cost, Recent event counts, Outliers,
// Runs, Events) are internal-audience clutter for the common case -- hidden
// entirely behind this toggle regardless of each panel's own expand/collapse
// state, which stays exactly as the user left it for next time dev mode
// comes back on.
function applyDevModeVisibility(enabled) {
  document.querySelectorAll('[data-dev-mode-panel]').forEach(function (panel) {
    panel.hidden = !enabled;
  });
}
function installDevModeToggle() {
  var toggle = document.getElementById('devModeToggle');
  var enabled = isDevModeStoredEnabled();
  if (toggle) toggle.checked = enabled;
  applyDevModeVisibility(enabled);
  // Self-heals the chrome.storage mirror the service worker reads (e.g.
  // this build's first run, or if chrome.storage was cleared) even when
  // the user never touches the toggle this session.
  try {
    browser.storage.local.set(_defineProperty({}, DEV_MODE_SYNC_STORAGE_KEY, enabled))["catch"](function () {});
  } catch (_unused4) {}
  toggle === null || toggle === void 0 || toggle.addEventListener('change', function () {
    setDevModeStoredEnabled(toggle.checked);
    applyDevModeVisibility(toggle.checked);
  });
}
function installPanelToggleListeners() {
  document.querySelectorAll('[data-panel-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      var targetId = button.getAttribute('data-panel-target') || '';
      var target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      var expanded = button.getAttribute('aria-expanded') !== 'false';
      var nextExpanded = !expanded;
      var panel = target.closest('.panel');
      button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      button.textContent = nextExpanded ? 'v' : '>';
      var panelLabel = targetId === 'queueList' ? 'Current Work' : targetId.replace(/List$/, '');
      button.setAttribute('aria-label', "".concat(nextExpanded ? 'Collapse' : 'Expand', " ").concat(panelLabel));
      target.hidden = !nextExpanded;
      if (panel) {
        panel.classList.toggle('panel--collapsed', !nextExpanded);
      }
    });
  });
}
function installPanelWheelScrollListeners() {
  document.querySelectorAll('[data-panel-scroll-target]').forEach(function (panel) {
    panel.addEventListener('wheel', function (event) {
      if (event.defaultPrevented) return;
      var targetId = panel.getAttribute('data-panel-scroll-target') || '';
      var scrollTarget = targetId ? document.getElementById(targetId) : null;
      if (!scrollTarget || scrollTarget.hidden) return;
      if (scrollTarget.contains(event.target)) return;
      if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return;
      scrollTarget.scrollBy({
        top: event.deltaY,
        left: event.deltaX,
        behavior: 'auto'
      });
      event.preventDefault();
    }, {
      passive: false
    });
  });
}
function openPreferences() {
  return _openPreferences.apply(this, arguments);
}
function _openPreferences() {
  _openPreferences = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee11() {
    var url;
    return _regeneratorRuntime().wrap(function _callee11$(_context11) {
      while (1) switch (_context11.prev = _context11.next) {
        case 0:
          url = browser.runtime.getURL('popup.html');
          _context11.next = 3;
          return browser.tabs.create({
            url: url,
            active: true
          })["catch"](function () {
            window.open(url, '_blank', 'noopener');
          });
        case 3:
        case "end":
          return _context11.stop();
      }
    }, _callee11);
  }));
  return _openPreferences.apply(this, arguments);
}
function startCoordinatorQueue() {
  return _startCoordinatorQueue.apply(this, arguments);
}
function _startCoordinatorQueue() {
  _startCoordinatorQueue = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee12() {
    var button, result;
    return _regeneratorRuntime().wrap(function _callee12$(_context12) {
      while (1) switch (_context12.prev = _context12.next) {
        case 0:
          button = document.getElementById('startCoordinatorButton');
          flashButton(button);
          retryFailedLastResult = {
            reason: 'starting-current-work'
          };
          render();
          _context12.next = 6;
          return sendRuntimeMessageWithTimeout({
            action: 'resume-coordinator-queue',
            allowBeforeQuora: true,
            userInitiated: true
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 6:
          result = _context12.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'start-current-work-failed' : (result === null || result === void 0 ? void 0 : result.reason) || 'start-current-work-scheduled'
          };
          if (result && !result.requiresQuoraVisit) {
            setQuoraVisitRequirement(false);
          }
          _context12.next = 11;
          return loadState();
        case 11:
          render();
        case 12:
        case "end":
          return _context12.stop();
      }
    }, _callee12);
  }));
  return _startCoordinatorQueue.apply(this, arguments);
}
function announceCoordinatorPageReady() {
  return _announceCoordinatorPageReady.apply(this, arguments);
}
function _announceCoordinatorPageReady() {
  _announceCoordinatorPageReady = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee13() {
    return _regeneratorRuntime().wrap(function _callee13$(_context13) {
      while (1) switch (_context13.prev = _context13.next) {
        case 0:
          _context13.prev = 0;
          _context13.next = 3;
          return sendRuntimeMessageWithTimeout({
            action: 'coordinator-page-ready'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 3:
          return _context13.abrupt("return", _context13.sent);
        case 6:
          _context13.prev = 6;
          _context13.t0 = _context13["catch"](0);
        case 8:
          return _context13.abrupt("return", null);
        case 9:
        case "end":
          return _context13.stop();
      }
    }, _callee13, null, [[0, 6]]);
  }));
  return _announceCoordinatorPageReady.apply(this, arguments);
}
function resetMetrics() {
  return _resetMetrics.apply(this, arguments);
}
function _resetMetrics() {
  _resetMetrics = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee14() {
    var result;
    return _regeneratorRuntime().wrap(function _callee14$(_context14) {
      while (1) switch (_context14.prev = _context14.next) {
        case 0:
          _context14.prev = 0;
          _context14.next = 3;
          return sendRuntimeMessageWithTimeout({
            action: 'reset-queue-wakeup-metrics'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 3:
          result = _context14.sent;
          if (!(result !== null && result !== void 0 && result.reset)) {
            _context14.next = 8;
            break;
          }
          _context14.next = 7;
          return loadState();
        case 7:
          render();
        case 8:
          _context14.next = 13;
          break;
        case 10:
          _context14.prev = 10;
          _context14.t0 = _context14["catch"](0);
          console.warn('Failed to reset metrics', _context14.t0);
        case 13:
        case "end":
          return _context14.stop();
      }
    }, _callee14, null, [[0, 10]]);
  }));
  return _resetMetrics.apply(this, arguments);
}
function clearCoordinatorTerminalStats() {
  return _clearCoordinatorTerminalStats.apply(this, arguments);
} // One button for the dev-mode panels' individually-scattered clear buttons
// (Metrics, Scan cost, Authority state reads, Recent event counts,
// Outliers) plus the Current Work summary row's Terminal/Events tiles --
// resetMetrics covers the first three (all backed by the same
// queue-wakeup-metrics storage), clearEventHistogram/clearOutliers are
// tab-local only, clearCoordinatorTerminalStats stamps the dashboard-side
// cutoff Terminal reads against (see COORDINATOR_STATS_CLEARED_AT_KEY in
// sw.js -- nothing is deleted, queued/active rows are never affected), and
// clearEvents wipes the durable mbCoordinatorEvents log itself, not just its
// display, so "Clear All Stats" is an unambiguous zeroing of everything
// shown in that row.
function _clearCoordinatorTerminalStats() {
  _clearCoordinatorTerminalStats = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee15() {
    return _regeneratorRuntime().wrap(function _callee15$(_context15) {
      while (1) switch (_context15.prev = _context15.next) {
        case 0:
          _context15.prev = 0;
          _context15.next = 3;
          return sendRuntimeMessageWithTimeout({
            action: 'clear-coordinator-terminal-stats'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 3:
          _context15.next = 8;
          break;
        case 5:
          _context15.prev = 5;
          _context15.t0 = _context15["catch"](0);
          console.warn('Failed to clear terminal stats', _context15.t0);
        case 8:
        case "end":
          return _context15.stop();
      }
    }, _callee15, null, [[0, 5]]);
  }));
  return _clearCoordinatorTerminalStats.apply(this, arguments);
}
function clearAllStats() {
  return _clearAllStats.apply(this, arguments);
}
function _clearAllStats() {
  _clearAllStats = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee16() {
    return _regeneratorRuntime().wrap(function _callee16$(_context16) {
      while (1) switch (_context16.prev = _context16.next) {
        case 0:
          _context16.next = 2;
          return resetMetrics();
        case 2:
          _context16.next = 4;
          return clearCoordinatorTerminalStats();
        case 4:
          clearEventHistogram();
          clearOutliers();
          _context16.next = 8;
          return clearEvents();
        case 8:
          _context16.next = 10;
          return loadState();
        case 10:
          render();
        case 11:
        case "end":
          return _context16.stop();
      }
    }, _callee16);
  }));
  return _clearAllStats.apply(this, arguments);
}
function loadState() {
  return _loadState.apply(this, arguments);
}
function _loadState() {
  _loadState = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee17() {
    var stored;
    return _regeneratorRuntime().wrap(function _callee17$(_context17) {
      while (1) switch (_context17.prev = _context17.next) {
        case 0:
          _context17.next = 2;
          return browser.storage.local.get(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty({}, COORDINATOR_RUNS_KEY, {}), COORDINATOR_EVENTS_KEY, []), QUEUE_WAKEUP_METRICS_VIEW_KEY, {}), SPACE_REGISTRY_KEY, {}), HIDDEN_RUNS_KEY, []), COORDINATOR_RETRY_FAILED_ENABLED_KEY, false), COORDINATOR_PAUSED_KEY, false), LAST_ENQUEUE_SUMMARY_KEY, null));
        case 2:
          stored = _context17.sent;
          _context17.next = 5;
          return refreshCompactQueueView();
        case 5:
          _context17.next = 7;
          return refreshCompactRunsView();
        case 7:
          if (_context17.sent) {
            _context17.next = 9;
            break;
          }
          state.runs = normalizeObject(stored[COORDINATOR_RUNS_KEY]);
        case 9:
          state.events = normalizeEvents(stored[COORDINATOR_EVENTS_KEY]);
          if (!hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
            _context17.next = 14;
            break;
          }
          state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY]);
          _context17.next = 16;
          break;
        case 14:
          _context17.next = 16;
          return refreshCompactMetricsView();
        case 16:
          state.spaceRegistry = normalizeObject(stored[SPACE_REGISTRY_KEY]);
          state.hiddenRunIds = normalizeStringList(stored[HIDDEN_RUNS_KEY]);
          retryFailedActive = !!stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY];
          state.paused = !!stored[COORDINATOR_PAUSED_KEY];
          state.lastEnqueueSummary = stored[LAST_ENQUEUE_SUMMARY_KEY] || null;
        case 21:
        case "end":
          return _context17.stop();
      }
    }, _callee17);
  }));
  return _loadState.apply(this, arguments);
}
function refreshCompactQueueView() {
  return _refreshCompactQueueView.apply(this, arguments);
}
function _refreshCompactQueueView() {
  _refreshCompactQueueView = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee18() {
    var result;
    return _regeneratorRuntime().wrap(function _callee18$(_context18) {
      while (1) switch (_context18.prev = _context18.next) {
        case 0:
          _context18.next = 2;
          return sendRuntimeMessageWithTimeout({
            action: 'refresh-coordinator-queue-view',
            reason: 'dashboard-load-missing-view'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS);
        case 2:
          result = _context18.sent;
          if (!hasCoordinatorQueueView(result === null || result === void 0 ? void 0 : result.view)) {
            _context18.next = 6;
            break;
          }
          applyCoordinatorQueueView(result.view);
          return _context18.abrupt("return", true);
        case 6:
          // mbCoordinatorQueueView is no longer persisted to disk (see sw.js's
          // refreshCoordinatorQueueViewForDashboard) -- there's no storage fallback
          // to read if the message above timed out or came back empty.
          applyCoordinatorQueueView({
            version: 1,
            updatedAt: Date.now(),
            total: 0,
            counts: {},
            itemLimit: 0,
            truncated: false,
            items: []
          });
          return _context18.abrupt("return", false);
        case 8:
        case "end":
          return _context18.stop();
      }
    }, _callee18);
  }));
  return _refreshCompactQueueView.apply(this, arguments);
}
function refreshCompactRunsView() {
  return _refreshCompactRunsView.apply(this, arguments);
}
function _refreshCompactRunsView() {
  _refreshCompactRunsView = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee19() {
    var result;
    return _regeneratorRuntime().wrap(function _callee19$(_context19) {
      while (1) switch (_context19.prev = _context19.next) {
        case 0:
          _context19.next = 2;
          return sendRuntimeMessageWithTimeout({
            action: 'refresh-coordinator-runs-view',
            reason: 'dashboard-load'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS);
        case 2:
          result = _context19.sent;
          if (!(result !== null && result !== void 0 && result.runs && _typeof(result.runs) === 'object' && !Array.isArray(result.runs))) {
            _context19.next = 6;
            break;
          }
          state.runs = result.runs;
          return _context19.abrupt("return", true);
        case 6:
          return _context19.abrupt("return", false);
        case 7:
        case "end":
          return _context19.stop();
      }
    }, _callee19);
  }));
  return _refreshCompactRunsView.apply(this, arguments);
}
function hasCoordinatorQueueView() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : state.queueView;
  return !!value && _typeof(value) === 'object' && !Array.isArray(value) && Number.parseInt(value.version, 10) >= 1 && Array.isArray(value.items);
}
function refreshCompactMetricsView() {
  return _refreshCompactMetricsView.apply(this, arguments);
}
function _refreshCompactMetricsView() {
  _refreshCompactMetricsView = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee20() {
    var result, stored;
    return _regeneratorRuntime().wrap(function _callee20$(_context20) {
      while (1) switch (_context20.prev = _context20.next) {
        case 0:
          _context20.next = 2;
          return sendRuntimeMessageWithTimeout({
            action: 'refresh-queue-wakeup-metrics-view',
            reason: 'dashboard-load-missing-view'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS);
        case 2:
          result = _context20.sent;
          if (!hasQueueWakeupMetricsView(result === null || result === void 0 ? void 0 : result.view)) {
            _context20.next = 6;
            break;
          }
          state.metrics = normalizeMetrics(result.view);
          return _context20.abrupt("return", true);
        case 6:
          _context20.next = 8;
          return browser.storage.local.get(_defineProperty({}, QUEUE_WAKEUP_METRICS_VIEW_KEY, {}));
        case 8:
          stored = _context20.sent;
          if (!hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
            _context20.next = 12;
            break;
          }
          state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY]);
          return _context20.abrupt("return", true);
        case 12:
          state.metrics = normalizeMetrics({});
          return _context20.abrupt("return", false);
        case 14:
        case "end":
          return _context20.stop();
      }
    }, _callee20);
  }));
  return _refreshCompactMetricsView.apply(this, arguments);
}
function hasQueueWakeupMetricsView() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : state.metrics;
  return !!value && _typeof(value) === 'object' && !Array.isArray(value) && Number.parseInt(value.version, 10) >= 1 && Number.parseInt(value.viewVersion, 10) >= 1 && !!value.currentEpoch;
}
function applyCoordinatorQueueView() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var view = hasCoordinatorQueueView(value) ? value : {};
  var items = Array.isArray(view.items) ? view.items : [];
  state.queueView = view;
  state.queue = Object.fromEntries(items.filter(function (item) {
    return item && _typeof(item) === 'object';
  }).map(function (item, index) {
    var storageKey = "".concat(item.storageKey || item.targetProfileHref || item.requestedUrl || item.dedupeKey || item.id || "view-item-".concat(index)).trim();
    return [storageKey, _objectSpread(_objectSpread({}, item), {}, {
      storageKey: storageKey
    })];
  }));
  state.queueCounts = normalizeObject(view.counts);
  state.queueTotal = Number.parseInt(view.total, 10) || items.length;
  state.queueTruncated = view.truncated === true;
}
function normalizeObject(value) {
  return value && _typeof(value) === 'object' && !Array.isArray(value) ? value : {};
}
function normalizeEvents(value) {
  if (Array.isArray(value)) return value.filter(function (event) {
    return event && _typeof(event) === 'object';
  });
  var objectValue = normalizeObject(value);
  return Object.values(objectValue).filter(function (event) {
    return event && _typeof(event) === 'object';
  });
}
function normalizeMetrics(value) {
  var metrics = normalizeObject(value);
  var currentEpoch = normalizeObject(metrics.currentEpoch);
  if (Object.keys(currentEpoch).length) {
    return _objectSpread(_objectSpread({}, metrics), {}, {
      currentEpoch: _objectSpread(_objectSpread({}, currentEpoch), {}, {
        counters: normalizeObject(currentEpoch.counters),
        phases: normalizeObject(currentEpoch.phases),
        journal: Array.isArray(currentEpoch.journal) ? currentEpoch.journal.filter(function (entry) {
          return entry && _typeof(entry) === 'object';
        }) : []
      }),
      previousEpochs: Array.isArray(metrics.previousEpochs) ? metrics.previousEpochs.filter(function (entry) {
        return entry && _typeof(entry) === 'object';
      }) : [],
      lifetime: normalizeObject(metrics.lifetime)
    });
  }
  return _objectSpread(_objectSpread({}, metrics), {}, {
    counters: normalizeObject(metrics.counters),
    phases: normalizeObject(metrics.phases),
    journal: Array.isArray(metrics.journal) ? metrics.journal.filter(function (entry) {
      return entry && _typeof(entry) === 'object';
    }) : []
  });
}
function normalizeStringList(value) {
  return Array.isArray(value) ? value.map(function (item) {
    return "".concat(item || '').trim();
  }).filter(Boolean) : [];
}
function countQueueStatuses() {
  var items = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var counts = {};
  var _iterator = _createForOfIteratorHelper(items || []),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var item = _step.value;
      var status = "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim() || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return counts;
}
function getQueueStatusCount() {
  var _state$queueCounts;
  var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var queueItems = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];
  if (hasCoordinatorQueueView()) return Number((_state$queueCounts = state.queueCounts) === null || _state$queueCounts === void 0 ? void 0 : _state$queueCounts[status]) || 0;
  return queueItems.filter(function (item) {
    return "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim() === status;
  }).length;
}
function getQueueTerminalCount() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  if (hasCoordinatorQueueView()) {
    return Object.entries(state.queueCounts || {}).filter(function (_ref5) {
      var _ref6 = _slicedToArray(_ref5, 1),
        status = _ref6[0];
      return isTerminalQueueStatus(status);
    }).reduce(function (total, _ref7) {
      var _ref8 = _slicedToArray(_ref7, 2),
        count = _ref8[1];
      return total + (Number(count) || 0);
    }, 0);
  }
  return queueItems.filter(isTerminalQueueItem).length;
}
function getQueueTotalCount() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  return hasCoordinatorQueueView() ? Number(state.queueTotal) || queueItems.length : queueItems.length;
}

// The worker window's minimal "idiot light" status bar -- deliberately not
// the full control-panel dashboard (see nits3.md item 5 discussion): just a
// window-width progress fill of handled-vs-total Current Work items, a
// count, and the handful of actions relevant to a background worker window.
function renderWorkerBar() {
  var total = getQueueTotalCount();
  var terminal = getQueueTerminalCount();
  var fill = document.getElementById('workerBarFill');
  var count = document.getElementById('workerBarCount');
  var pauseResumeButton = document.getElementById('workerBarPauseResume');
  var cancelButton = document.getElementById('workerBarCancel');
  if (fill) fill.style.width = "".concat(total > 0 ? Math.min(100, Math.round(terminal / total * 100)) : 0, "%");
  if (count) count.textContent = "".concat(terminal, " / ").concat(total);
  if (pauseResumeButton) {
    var pausePending = currentWorkPausePending === 'pause';
    var resumePending = currentWorkPausePending === 'resume';
    pauseResumeButton.textContent = pausePending ? 'Pausing...' : resumePending ? 'Resuming...' : state.paused ? 'Resume' : 'Pause';
    pauseResumeButton.disabled = pausePending || resumePending;
  }
  if (cancelButton) {
    var pendingCount = getPendingCurrentWorkItems().length;
    cancelButton.disabled = pendingCount <= 0;
  }
}

// The plain dashboard's own footer strip -- same handled-vs-total fill as
// renderWorkerBar, but for the real control-panel page itself rather than
// the worker window. `queueItems` is threaded through so this stays in sync
// with whatever render() just computed for the summary tiles, instead of
// re-deriving it from state on its own.
function renderDashboardBottomBar() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var total = getQueueTotalCount(queueItems);
  var terminal = getQueueTerminalCount(queueItems);
  var fill = document.getElementById('dashboardBottomBarFill');
  var count = document.getElementById('dashboardBottomBarCount');
  if (fill) fill.style.width = "".concat(total > 0 ? Math.min(100, Math.round(terminal / total * 100)) : 0, "%");
  if (count) count.textContent = "".concat(terminal, " / ").concat(total);
}

// The bottom-bar logo is a "jump to the real dashboard" shortcut, meant to
// work the same way wherever this bar ends up rendering -- a deliberate
// no-op when the page showing it is already the plain dashboard (currently
// the only place it renders, but the guard is what the button is supposed
// to mean regardless of where it's embedded).
function openDashboardFromBottomBar() {
  return _openDashboardFromBottomBar.apply(this, arguments);
}
function _openDashboardFromBottomBar() {
  _openDashboardFromBottomBar = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee21() {
    return _regeneratorRuntime().wrap(function _callee21$(_context21) {
      while (1) switch (_context21.prev = _context21.next) {
        case 0:
          if (!(!isQueuedWorkerActionSurfacePage() && !isCoordinatorHistoryPage())) {
            _context21.next = 2;
            break;
          }
          return _context21.abrupt("return");
        case 2:
          _context21.next = 4;
          return openCoordinatorViewFromHere('open-coordinator');
        case 4:
        case "end":
          return _context21.stop();
      }
    }, _callee21);
  }));
  return _openDashboardFromBottomBar.apply(this, arguments);
}
function getBlockOutcomeCounts() {
  var metricsDocument = state.metrics || {};
  var counters = (metricsDocument.currentEpoch || metricsDocument).counters || {};
  var reallyBlockedCount = getMetricCounter(counters, 'profileAction.reallyBlocked.count');
  var alreadyBlockedCount = getMetricCounter(counters, 'profileAction.alreadyBlocked.count');
  // Not folded into `total`/the really-vs-already-blocked percentages --
  // this is a different category (skipped, not a block outcome at all),
  // just reusing the same counted-stat mechanism.
  var blockAttemptOnFollowingCount = getMetricCounter(counters, 'profileAction.blockAttemptOnFollowing.count');
  var total = reallyBlockedCount + alreadyBlockedCount;
  return {
    reallyBlockedCount: reallyBlockedCount,
    alreadyBlockedCount: alreadyBlockedCount,
    blockAttemptOnFollowingCount: blockAttemptOnFollowingCount,
    total: total,
    // Recorded by recordCoordinatorProfileActionOutcomeStat
    // (swCoordinatorProgressReducer.js) alongside the counts above, one
    // pair per outcome bucket -- see formatBlockOutcomeDuration for how
    // these become an avg/max on the summary tile. durationSampleCount is
    // the avg denominator, not reallyBlockedCount/alreadyBlockedCount --
    // it excludes any sample over PROFILE_ACTION_TIMING_SAMPLE_MAX_PLAUSIBLE_MS
    // (a stale-backlog row or WAL-recovery gap), which the *Count fields
    // above intentionally still include since those feed the outcome
    // percentage tile, not a duration average.
    reallyBlockedDurationSampleCount: getMetricCounter(counters, 'profileAction.reallyBlocked.durationSampleCount'),
    reallyBlockedTotalDurationMs: getMetricCounter(counters, 'profileAction.reallyBlocked.totalDurationMs'),
    reallyBlockedMaxDurationMs: getMetricCounter(counters, 'profileAction.reallyBlocked.maxDurationMs'),
    alreadyBlockedDurationSampleCount: getMetricCounter(counters, 'profileAction.alreadyBlocked.durationSampleCount'),
    alreadyBlockedTotalDurationMs: getMetricCounter(counters, 'profileAction.alreadyBlocked.totalDurationMs'),
    alreadyBlockedMaxDurationMs: getMetricCounter(counters, 'profileAction.alreadyBlocked.maxDurationMs')
  };
}
function formatBlockOutcomeCount() {
  var count = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var total = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  return total > 0 ? "".concat(count, " (").concat(formatPercent(count / total), ")") : "".concat(count);
}
function formatBlockOutcomeDuration() {
  var count = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var totalDurationMs = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var maxDurationMs = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
  if (!count) return 'no completions yet this epoch';
  return "avg ".concat(formatDuration(totalDurationMs / count), ", max ").concat(formatDuration(maxDurationMs), " active-to-terminal");
}
function render() {
  if (isQueuedWorkerActionSurfacePage()) {
    renderWorkerBar();
    return;
  }
  var queueItems = getDisplayQueueItems();
  var runItems = getDisplayRuns(queueItems);
  refreshQuoraVisitRequirement(queueItems);
  var queuedCount = getQueueStatusCount('queued', queueItems);
  var activeCount = getQueueStatusCount('opening', queueItems) + getQueueStatusCount('active', queueItems) + getQueueStatusCount('acting', queueItems) + getQueueStatusCount('settling', queueItems);
  var terminalCount = getQueueTerminalCount(queueItems);
  var secondsPerBlock = getSecondsPerActualBlock(queueItems, getCurrentMetricsEpochStartedAt());
  var secondsPerAlreadyBlocked = getSecondsPerAlreadyBlocked(queueItems, getCurrentMetricsEpochStartedAt());
  var activationHandoff = getActivationHandoffSeconds(queueItems, getCurrentMetricsEpochStartedAt());
  var failedCount = getQueueStatusCount('failed', queueItems);
  var canceledCount = getQueueStatusCount('canceled', queueItems);
  var succeededCount = getQueueStatusCount('succeeded', queueItems);
  var retryableFailureShapeCount = queueItems.filter(isRetryableFailedQueueItem).length;
  var retryableFailedCount = queueItems.filter(isEligibleRetryFailedQueueItem).length;
  var exhaustedRetryableFailedCount = Math.max(0, retryableFailureShapeCount - retryableFailedCount);
  var hardFailedCount = Math.max(0, failedCount - retryableFailedCount);
  setText('queuedCount', queuedCount);
  setText('currentWorkReadyCount', getCurrentWorkSummaryText(queueItems, {
    queuedCount: queuedCount,
    succeededCount: succeededCount,
    retryableFailedCount: retryableFailedCount,
    hardFailedCount: hardFailedCount
  }));
  setText('activeCount', activeCount);
  setText('secondsPerBlock', formatSecondsPerBlock(secondsPerBlock));
  setText('secondsPerAlreadyBlocked', formatSecondsPerBlock(secondsPerAlreadyBlocked));
  setText('activationHandoffSeconds', formatSecondsPerBlock(activationHandoff));
  var blockOutcomeCounts = getBlockOutcomeCounts();
  setText('reallyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.reallyBlockedCount, blockOutcomeCounts.total));
  setText('alreadyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.alreadyBlockedCount, blockOutcomeCounts.total));
  setText('reallyBlockedDuration', formatBlockOutcomeDuration(blockOutcomeCounts.reallyBlockedDurationSampleCount, blockOutcomeCounts.reallyBlockedTotalDurationMs, blockOutcomeCounts.reallyBlockedMaxDurationMs));
  setText('alreadyBlockedDuration', formatBlockOutcomeDuration(blockOutcomeCounts.alreadyBlockedDurationSampleCount, blockOutcomeCounts.alreadyBlockedTotalDurationMs, blockOutcomeCounts.alreadyBlockedMaxDurationMs));
  setText('blockAttemptOnFollowingCount', blockOutcomeCounts.blockAttemptOnFollowingCount);
  setText('terminalCount', terminalCount);
  setText('eventCount', state.events.length);
  setText('eventListCount', "".concat(state.events.length, " event").concat(state.events.length === 1 ? '' : 's'));
  setText('runCount', "".concat(runItems.length, " run").concat(runItems.length === 1 ? '' : 's'));
  var queueTotalCount = getQueueTotalCount(queueItems);
  setText('queueCount', "".concat(queueTotalCount, " job").concat(queueTotalCount === 1 ? '' : 's').concat(state.queueTruncated ? " (".concat(queueItems.length, " shown)") : ''));
  setText('refreshState', getRefreshStateText());
  renderRuns(runItems);
  renderEvents();
  renderWakeupMetrics(queueItems);
  renderScanCostHistogram();
  renderAuthorityLoadHistogram();
  renderEventHistogram();
  renderPhaseTimingHistogram();
  renderQueue(queueItems);
  checkCoordinatorOutliers(queueItems);
  renderOutliers();
  renderDashboardBottomBar(queueItems);
  syncRetryFailedControls(queueItems, retryableFailedCount, exhaustedRetryableFailedCount);
  syncRequeueFailedControls(failedCount + canceledCount);
  syncCurrentWorkPauseControls(queueItems);
  syncStartCoordinatorControls();
  syncLastEnqueueSummary();
}

// Durable counterpart to the transient nuke-button notice: shows the most
// recent enqueue's requested/queued/merged breakdown so a big submission
// that mostly deduped against already-known rows (currently queued, or a
// past terminal outcome) doesn't look like most of it silently vanished --
// this was previously only visible as free text buried in the capped
// mbCoordinatorEvents log. Self-expires after LAST_ENQUEUE_SUMMARY_MAX_AGE_MS
// so it doesn't linger indefinitely as stale context from a much earlier add.
// Shared by the transient "last enqueue" banner (below) and each run's own
// durable subtitle (getRunDisplay) -- same requested/queued/merged/preFilter
// shape, just sourced from a different summary object (the single global
// "last enqueue across any run" one vs. a specific run's own accumulated
// enqueueRequested/enqueueQueued/enqueueMerged/enqueuePreFilter fields).
function formatCoordinatorEnqueueBreakdown() {
  var summary = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!summary) return '';
  var requested = Number.parseInt(summary.requested, 10) || 0;
  var queued = Number.parseInt(summary.queued, 10) || 0;
  var merged = Number.parseInt(summary.merged, 10) || 0;
  if (!requested) return '';
  var noticeParts = [];
  if (merged > 0) noticeParts.push("".concat(merged, " already known"));

  // preFilter counts candidates a space-feed submission dropped before
  // "requested" was even built (already nuked, no resolvable profile,
  // several posts by the same author collapsing to one profile) -- without
  // this, "requested" alone understates how big the original selection
  // was and the drop looks unexplained.
  var preFilter = summary.preFilter;
  var totalCandidates = Number.parseInt(preFilter === null || preFilter === void 0 ? void 0 : preFilter.totalCandidates, 10) || 0;
  if (preFilter && totalCandidates > requested) {
    if (preFilter.alreadyNuked) noticeParts.push("".concat(preFilter.alreadyNuked, " already nuked"));
    if (preFilter.duplicateProfile) noticeParts.push("".concat(preFilter.duplicateProfile, " duplicate profile"));
    if (preFilter.unqueueable) noticeParts.push("".concat(preFilter.unqueueable, " unresolvable"));
  }
  var fromLabel = preFilter && totalCandidates > requested ? totalCandidates : requested;
  return noticeParts.length ? "".concat(fromLabel, " candidates -> ").concat(queued, " new (").concat(noticeParts.join(', '), ")") : "".concat(fromLabel, " candidates -> ").concat(queued, " new");
}
function syncLastEnqueueSummary() {
  var element = document.getElementById('lastEnqueueSummary');
  if (!element) return;
  var summary = state.lastEnqueueSummary;
  var at = Number.parseInt(summary === null || summary === void 0 ? void 0 : summary.at, 10) || 0;
  if (!summary || !at || Date.now() - at > LAST_ENQUEUE_SUMMARY_MAX_AGE_MS) {
    element.hidden = true;
    element.textContent = '';
    return;
  }
  var breakdown = formatCoordinatorEnqueueBreakdown(summary);
  element.hidden = !breakdown;
  element.textContent = breakdown ? "Last add: ".concat(breakdown) : '';
}
function getCurrentWorkSummaryText() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var counts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var totalCount = getQueueTotalCount(queueItems);
  var shownCount = state.queueTruncated ? queueItems.length : totalCount;
  var showingText = state.queueTruncated ? "Showing ".concat(shownCount, " of ").concat(totalCount) : "Showing ".concat(totalCount);
  var queuedCount = Number.parseInt(counts.queuedCount, 10) || 0;
  var succeededCount = Number.parseInt(counts.succeededCount, 10) || 0;
  var softFailedCount = Number.parseInt(counts.retryableFailedCount, 10) || 0;
  var hardFailedCount = Number.parseInt(counts.hardFailedCount, 10) || 0;
  return "".concat(showingText, ", ").concat(queuedCount, " queued, ").concat(succeededCount, " succeeded, ").concat(softFailedCount, " soft-fail, ").concat(hardFailedCount, " hard-fail");
}
function clearEvents() {
  return _clearEvents.apply(this, arguments);
}
function _clearEvents() {
  _clearEvents = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee22() {
    return _regeneratorRuntime().wrap(function _callee22$(_context22) {
      while (1) switch (_context22.prev = _context22.next) {
        case 0:
          _context22.next = 2;
          return browser.storage.local.set(_defineProperty({}, COORDINATOR_EVENTS_KEY, []));
        case 2:
          state.events = [];
          render();
        case 4:
        case "end":
          return _context22.stop();
      }
    }, _callee22);
  }));
  return _clearEvents.apply(this, arguments);
}
function clearCompletedRuns() {
  return _clearCompletedRuns.apply(this, arguments);
}
function _clearCompletedRuns() {
  _clearCompletedRuns = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee23() {
    var runItems, nextHiddenRunIds, _iterator8, _step8, run, runId;
    return _regeneratorRuntime().wrap(function _callee23$(_context23) {
      while (1) switch (_context23.prev = _context23.next) {
        case 0:
          runItems = getDisplayRuns(getDisplayQueueItems(), {
            includeHidden: true
          });
          nextHiddenRunIds = new Set(state.hiddenRunIds || []);
          _iterator8 = _createForOfIteratorHelper(runItems);
          try {
            for (_iterator8.s(); !(_step8 = _iterator8.n()).done;) {
              run = _step8.value;
              runId = (run === null || run === void 0 ? void 0 : run.id) || (run === null || run === void 0 ? void 0 : run.runId) || '';
              if (runId && "".concat(run.status || '') === 'empty') {
                nextHiddenRunIds.add(runId);
              }
            }
          } catch (err) {
            _iterator8.e(err);
          } finally {
            _iterator8.f();
          }
          state.hiddenRunIds = Array.from(nextHiddenRunIds);
          _context23.next = 7;
          return browser.storage.local.set(_defineProperty({}, HIDDEN_RUNS_KEY, state.hiddenRunIds));
        case 7:
          render();
        case 8:
        case "end":
          return _context23.stop();
      }
    }, _callee23);
  }));
  return _clearCompletedRuns.apply(this, arguments);
}
function hasPendingCoordinatorQueueWork() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  return queueItems.some(function (item) {
    var status = "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim();
    return isPendingQueueStatus(status);
  });
}
function hasRawPendingCoordinatorQueueWork() {
  if (hasCoordinatorQueueView()) {
    return getQueueStatusCount('queued') > 0 || getQueueStatusCount('opening') > 0 || getQueueStatusCount('active') > 0 || getQueueStatusCount('acting') > 0 || getQueueStatusCount('settling') > 0;
  }
  return Object.values(state.queue || {}).some(function (item) {
    var status = "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim();
    return isPendingQueueStatus(status);
  });
}
function hasActiveCoordinatorQueueWork() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  return queueItems.some(isActiveQueueItem);
}
function hasRawActiveCoordinatorQueueWork() {
  if (hasCoordinatorQueueView()) {
    return getQueueStatusCount('opening') > 0 || getQueueStatusCount('active') > 0 || getQueueStatusCount('acting') > 0 || getQueueStatusCount('settling') > 0;
  }
  return Object.values(state.queue || {}).some(isActiveQueueItem);
}
function getQueuedCoordinatorQueueCount() {
  if (hasCoordinatorQueueView()) return getQueueStatusCount('queued');
  return Object.values(state.queue || {}).filter(function (item) {
    return "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim() === 'queued';
  }).length;
}
function isRetryableFailedQueueItem() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  return isRetryableCoordinatorFailure(item);
}
function getRetryFailedCount() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  return Number.parseInt(item === null || item === void 0 ? void 0 : item.retryCount, 10) || 0;
}
function isEligibleRetryFailedQueueItem() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  return isRetryableFailedQueueItem(item) && getRetryFailedCount(item) < RETRY_FAILED_LIMIT;
}
function syncRetryFailedControls() {
  var _retryFailedLastResul;
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var retryableFailedCount = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var exhaustedRetryableFailedCount = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
  var hasPendingWork = hasPendingCoordinatorQueueWork(queueItems) || hasRawPendingCoordinatorQueueWork();
  var hasActiveWork = hasActiveCoordinatorQueueWork(queueItems) || hasRawActiveCoordinatorQueueWork();
  var waitText = getRetryFailedWorkWaitText({
    hasPendingWork: hasPendingWork,
    hasActiveWork: hasActiveWork
  });
  var button = document.getElementById('retryFailedButton');
  if (button) {
    button.textContent = retryFailedActive ? 'Disable Retry Soft-Fails' : 'Enable Retry Soft-Fails';
    button.setAttribute('aria-pressed', retryFailedActive ? 'true' : 'false');
    button.title = retryFailedActive ? 'Turn soft-fail retry off' : 'Turn soft-fail retry on';
    button.disabled = false;
  }
  var lastReason = ((_retryFailedLastResul = retryFailedLastResult) === null || _retryFailedLastResul === void 0 ? void 0 : _retryFailedLastResul.reason) || '';
  var stateText = '';
  if (retryFailedActive && waitText) {
    stateText = "Soft-fail retry on; ".concat(waitText).concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (retryFailedActive && retryableFailedCount <= 0 && exhaustedRetryableFailedCount > 0) {
    stateText = "Soft-fail retry on; retry limit reached for ".concat(exhaustedRetryableFailedCount, " failure").concat(exhaustedRetryableFailedCount === 1 ? '' : 's').concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (retryFailedActive && retryableFailedCount <= 0) {
    stateText = "Soft-fail retry on; no soft-failures".concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (retryFailedActive) {
    stateText = "Soft-fail retry on".concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (waitText) {
    stateText = "Soft-fail retry off; ".concat(waitText).concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (retryableFailedCount <= 0 && exhaustedRetryableFailedCount > 0) {
    stateText = "Soft-fail retry off; retry limit reached for ".concat(exhaustedRetryableFailedCount, " failure").concat(exhaustedRetryableFailedCount === 1 ? '' : 's').concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else if (retryableFailedCount <= 0) {
    stateText = "Soft-fail retry off; no soft-failures".concat(lastReason ? " (".concat(lastReason, ")") : '');
  } else {
    stateText = "Soft-fail retry off".concat(lastReason ? " (".concat(lastReason, ")") : '');
  }
  setText('retryFailedState', stateText);
}
function syncStartCoordinatorControls() {
  var button = document.getElementById('startCoordinatorButton');
  if (!button) return;
  button.hidden = !state.requiresQuoraVisit;
  button.disabled = state.loading;
  button.title = state.requiresQuoraVisit ? 'Start Current Work without waiting for a Quora page' : 'Quora runtime is available';
}
function getRetryFailedWorkWaitText() {
  var _ref9 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
    _ref9$hasPendingWork = _ref9.hasPendingWork,
    hasPendingWork = _ref9$hasPendingWork === void 0 ? false : _ref9$hasPendingWork,
    _ref9$hasActiveWork = _ref9.hasActiveWork,
    hasActiveWork = _ref9$hasActiveWork === void 0 ? false : _ref9$hasActiveWork;
  if (!hasPendingWork) return '';
  if (state.requiresQuoraVisit) return 'waiting for first Quora page';
  if (hasActiveWork) return 'waiting for current work to idle';
  return 'queued work is waiting to start';
}
function syncRequeueFailedControls() {
  var requeueableCount = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var button = document.getElementById('requeueFailedButton');
  if (!button) return;
  button.disabled = requeueableCount <= 0;
  button.title = requeueableCount > 0 ? "Reset and requeue ".concat(requeueableCount, " failed/canceled Current Work job").concat(requeueableCount === 1 ? '' : 's') : 'No failed or canceled Current Work jobs to requeue';
}
function requeueFailed() {
  return _requeueFailed.apply(this, arguments);
}
function _requeueFailed() {
  _requeueFailed = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee24() {
    var items, requeueableCount, button, result;
    return _regeneratorRuntime().wrap(function _callee24$(_context24) {
      while (1) switch (_context24.prev = _context24.next) {
        case 0:
          items = getDisplayQueueItems();
          requeueableCount = getQueueStatusCount('failed', items) + getQueueStatusCount('canceled', items);
          if (!(requeueableCount <= 0)) {
            _context24.next = 6;
            break;
          }
          retryFailedLastResult = {
            reason: 'no-failed-current-work'
          };
          render();
          return _context24.abrupt("return");
        case 6:
          button = document.getElementById('requeueFailedButton');
          if (button) button.disabled = true;
          retryFailedLastResult = {
            reason: 'requeueing-failed'
          };
          render();
          _context24.next = 12;
          return sendRuntimeMessageWithTimeout({
            action: 'requeue-coordinator-failed'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 12:
          result = _context24.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'requeue-failed' : "requeued-".concat(Number.parseInt(result === null || result === void 0 ? void 0 : result.selected, 10) || 0)
          };
          _context24.next = 16;
          return loadState();
        case 16:
          render();
        case 17:
        case "end":
          return _context24.stop();
      }
    }, _callee24);
  }));
  return _requeueFailed.apply(this, arguments);
}
function cancelCurrentWorkItem() {
  return _cancelCurrentWorkItem.apply(this, arguments);
}
function _cancelCurrentWorkItem() {
  _cancelCurrentWorkItem = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee25() {
    var _result$canceledUrls, _result$canceledWorkK;
    var item,
      storageKey,
      profileHref,
      result,
      _args25 = arguments;
    return _regeneratorRuntime().wrap(function _callee25$(_context25) {
      while (1) switch (_context25.prev = _context25.next) {
        case 0:
          item = _args25.length > 0 && _args25[0] !== undefined ? _args25[0] : {};
          if (isPendingQueueStatus("".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim())) {
            _context25.next = 3;
            break;
          }
          return _context25.abrupt("return");
        case 3:
          storageKey = "".concat(item.storageKey || '').trim();
          profileHref = getQueueItemHref('', item);
          retryFailedLastResult = {
            reason: 'canceling-one-current-work'
          };
          render();
          _context25.next = 9;
          return sendRuntimeMessageWithTimeout({
            action: 'cancel-coordinator-current-work-item',
            storageKey: storageKey,
            coordinatorKey: storageKey,
            profileHref: profileHref
          }, {
            error: 'cancel-one-current-work-timeout'
          }, CURRENT_WORK_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 9:
          result = _context25.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'cancel-one-current-work-failed' : "canceled-".concat((Number.parseInt(result === null || result === void 0 || (_result$canceledUrls = result.canceledUrls) === null || _result$canceledUrls === void 0 ? void 0 : _result$canceledUrls.length, 10) || 0) + (Number.parseInt(result === null || result === void 0 || (_result$canceledWorkK = result.canceledWorkKeys) === null || _result$canceledWorkK === void 0 ? void 0 : _result$canceledWorkK.length, 10) || 0))
          };
          _context25.next = 13;
          return loadState();
        case 13:
          render();
        case 14:
        case "end":
          return _context25.stop();
      }
    }, _callee25);
  }));
  return _cancelCurrentWorkItem.apply(this, arguments);
}
function requeueFailedItem() {
  return _requeueFailedItem.apply(this, arguments);
}
function _requeueFailedItem() {
  _requeueFailedItem = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee26() {
    var item,
      itemStatus,
      storageKey,
      profileHref,
      result,
      _args26 = arguments;
    return _regeneratorRuntime().wrap(function _callee26$(_context26) {
      while (1) switch (_context26.prev = _context26.next) {
        case 0:
          item = _args26.length > 0 && _args26[0] !== undefined ? _args26[0] : {};
          itemStatus = "".concat((item === null || item === void 0 ? void 0 : item.status) || '');
          if (!(itemStatus !== 'failed' && itemStatus !== 'canceled')) {
            _context26.next = 4;
            break;
          }
          return _context26.abrupt("return");
        case 4:
          storageKey = "".concat(item.storageKey || '').trim();
          profileHref = getQueueItemHref('', item);
          retryFailedLastResult = {
            reason: 'requeueing-one-failed'
          };
          render();
          _context26.next = 10;
          return sendRuntimeMessageWithTimeout({
            action: 'requeue-coordinator-failed',
            storageKey: storageKey,
            coordinatorKey: storageKey,
            profileHref: profileHref
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 10:
          result = _context26.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'requeue-failed' : "requeued-".concat(Number.parseInt(result === null || result === void 0 ? void 0 : result.selected, 10) || 0)
          };
          _context26.next = 14;
          return loadState();
        case 14:
          render();
        case 15:
        case "end":
          return _context26.stop();
      }
    }, _callee26);
  }));
  return _requeueFailedItem.apply(this, arguments);
}
function getPendingCurrentWorkItems() {
  return getDisplayQueueItems().filter(function (item) {
    return isPendingQueueStatus("".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim());
  });
}
function syncCurrentWorkPauseControls() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var pendingCount = queueItems.filter(function (item) {
    return isPendingQueueStatus("".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim());
  }).length;
  var pauseButton = document.getElementById('pauseCurrentWorkButton');
  var pauseState = document.getElementById('pauseCurrentWorkState');
  var cancelButton = document.getElementById('cancelCurrentWorkButton');
  var pausePending = currentWorkPausePending === 'pause';
  var resumePending = currentWorkPausePending === 'resume';
  if (pauseButton) {
    pauseButton.textContent = pausePending ? 'Pausing...' : resumePending ? 'Resuming...' : state.paused ? 'Resume' : 'Pause';
    pauseButton.disabled = pausePending || resumePending;
    pauseButton.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    pauseButton.setAttribute('aria-busy', pausePending || resumePending ? 'true' : 'false');
    pauseButton.classList.toggle('clear-button--pause-active', state.paused);
    pauseButton.title = pausePending ? 'Pause request sent; waiting for Current Work to stop' : resumePending ? 'Resume request sent; waiting for Current Work to continue' : state.paused ? 'Resume paused Current Work' : pendingCount > 0 ? 'Pause Current Work without canceling jobs' : 'Pause now, before queueing more work';
  }
  if (pauseState) {
    pauseState.textContent = pausePending ? 'Pausing...' : resumePending ? 'Resuming...' : state.paused ? 'Paused' : 'Running';
    pauseState.classList.toggle('pause-state--paused', state.paused && !pausePending && !resumePending);
    pauseState.classList.toggle('pause-state--pending', pausePending || resumePending);
  }
  if (cancelButton) {
    cancelButton.disabled = pendingCount <= 0;
    cancelButton.title = pendingCount > 0 ? "Cancel ".concat(pendingCount, " pending Current Work job").concat(pendingCount === 1 ? '' : 's') : 'No pending Current Work to cancel';
  }
  var clearButton = document.getElementById('clearCurrentWorkButton');
  if (clearButton) {
    var totalCount = queueItems.length;
    clearButton.disabled = totalCount <= 0;
    clearButton.title = totalCount > 0 ? "Cancel and remove all ".concat(totalCount, " Current Work row").concat(totalCount === 1 ? '' : 's') : 'No Current Work to clear';
  }
}
function flashButton(button) {
  if (!button) return;
  button.classList.remove('clear-button--flash');
  void button.offsetWidth;
  button.classList.add('clear-button--flash');
  setTimeout(function () {
    return button.classList.remove('clear-button--flash');
  }, 700);
}
function toggleCurrentWorkPause() {
  return _toggleCurrentWorkPause.apply(this, arguments);
}
function _toggleCurrentWorkPause() {
  _toggleCurrentWorkPause = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee27() {
    var button, wasPaused, action, result;
    return _regeneratorRuntime().wrap(function _callee27$(_context27) {
      while (1) switch (_context27.prev = _context27.next) {
        case 0:
          button = document.getElementById('pauseCurrentWorkButton');
          flashButton(button);
          wasPaused = state.paused;
          currentWorkPausePending = wasPaused ? 'resume' : 'pause';
          render();
          action = state.paused ? 'resume-paused-coordinator-nukes' : 'pause-coordinator-nukes';
          _context27.next = 8;
          return sendRuntimeMessageWithTimeout({
            action: action
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 8:
          result = _context27.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? wasPaused ? 'resume-failed' : 'pause-failed' : wasPaused ? 'resumed-current-work' : 'paused-current-work'
          };
          currentWorkPausePending = '';
          _context27.next = 13;
          return loadState();
        case 13:
          render();
        case 14:
        case "end":
          return _context27.stop();
      }
    }, _callee27);
  }));
  return _toggleCurrentWorkPause.apply(this, arguments);
}
function cancelCurrentWork() {
  return _cancelCurrentWork.apply(this, arguments);
} // Unlike cancelCurrentWork (which only stops pending/active rows -- terminal
// rows stay in the completed-work log and keep showing up here), this asks
// the service worker to remove every Current Work row entirely, live or
// completed, so the list actually empties.
function _cancelCurrentWork() {
  _cancelCurrentWork = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee28() {
    var _result$canceledUrls2, _result$canceledWorkK2;
    var pendingCount, button, result;
    return _regeneratorRuntime().wrap(function _callee28$(_context28) {
      while (1) switch (_context28.prev = _context28.next) {
        case 0:
          pendingCount = getPendingCurrentWorkItems().length;
          if (!(pendingCount <= 0)) {
            _context28.next = 5;
            break;
          }
          retryFailedLastResult = {
            reason: 'no-pending-current-work'
          };
          render();
          return _context28.abrupt("return");
        case 5:
          button = document.getElementById('cancelCurrentWorkButton');
          if (button) button.disabled = true;
          retryFailedLastResult = {
            reason: 'canceling-current-work'
          };
          render();
          _context28.next = 11;
          return sendRuntimeMessageWithTimeout({
            action: 'cancel-coordinator-current-work'
          }, {
            error: 'cancel-current-work-timeout'
          }, CURRENT_WORK_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 11:
          result = _context28.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'cancel-current-work-failed' : "canceled-".concat((Number.parseInt(result === null || result === void 0 || (_result$canceledUrls2 = result.canceledUrls) === null || _result$canceledUrls2 === void 0 ? void 0 : _result$canceledUrls2.length, 10) || 0) + (Number.parseInt(result === null || result === void 0 || (_result$canceledWorkK2 = result.canceledWorkKeys) === null || _result$canceledWorkK2 === void 0 ? void 0 : _result$canceledWorkK2.length, 10) || 0))
          };
          _context28.next = 15;
          return loadState();
        case 15:
          render();
        case 16:
        case "end":
          return _context28.stop();
      }
    }, _callee28);
  }));
  return _cancelCurrentWork.apply(this, arguments);
}
function clearCurrentWork() {
  return _clearCurrentWork.apply(this, arguments);
}
function _clearCurrentWork() {
  _clearCurrentWork = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee29() {
    var _result$clearedUrls, _result$clearedWorkKe;
    var totalRowCount, button, result;
    return _regeneratorRuntime().wrap(function _callee29$(_context29) {
      while (1) switch (_context29.prev = _context29.next) {
        case 0:
          totalRowCount = getDisplayQueueItems().length;
          if (!(totalRowCount <= 0)) {
            _context29.next = 5;
            break;
          }
          retryFailedLastResult = {
            reason: 'no-current-work-to-clear'
          };
          render();
          return _context29.abrupt("return");
        case 5:
          button = document.getElementById('clearCurrentWorkButton');
          if (button) button.disabled = true;
          retryFailedLastResult = {
            reason: 'clearing-current-work'
          };
          render();
          _context29.next = 11;
          return sendRuntimeMessageWithTimeout({
            action: 'clear-coordinator-current-work'
          }, {
            error: 'clear-current-work-timeout'
          }, CURRENT_WORK_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 11:
          result = _context29.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'clear-current-work-failed' : "cleared-".concat((Number.parseInt(result === null || result === void 0 || (_result$clearedUrls = result.clearedUrls) === null || _result$clearedUrls === void 0 ? void 0 : _result$clearedUrls.length, 10) || 0) + (Number.parseInt(result === null || result === void 0 || (_result$clearedWorkKe = result.clearedWorkKeys) === null || _result$clearedWorkKe === void 0 ? void 0 : _result$clearedWorkKe.length, 10) || 0))
          };
          _context29.next = 15;
          return loadState();
        case 15:
          render();
        case 16:
        case "end":
          return _context29.stop();
      }
    }, _callee29);
  }));
  return _clearCurrentWork.apply(this, arguments);
}
function toggleRetryFailed() {
  return _toggleRetryFailed.apply(this, arguments);
}
function _toggleRetryFailed() {
  _toggleRetryFailed = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee30() {
    return _regeneratorRuntime().wrap(function _callee30$(_context30) {
      while (1) switch (_context30.prev = _context30.next) {
        case 0:
          if (!retryFailedActive) {
            _context30.next = 3;
            break;
          }
          stopRetryFailed('stopped');
          return _context30.abrupt("return");
        case 3:
          retryFailedActive = true;
          retryFailedLastResult = {
            reason: 'starting'
          };
          render();
          _context30.next = 8;
          return browser.storage.local.set(_defineProperty({}, COORDINATOR_RETRY_FAILED_ENABLED_KEY, true));
        case 8:
          retryFailedLastResult = {
            reason: 'service-worker-scheduled'
          };
          render();
        case 10:
        case "end":
          return _context30.stop();
      }
    }, _callee30);
  }));
  return _toggleRetryFailed.apply(this, arguments);
}
function stopRetryFailed() {
  var reason = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'idle';
  var _ref10 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
    _ref10$persist = _ref10.persist,
    persist = _ref10$persist === void 0 ? true : _ref10$persist;
  retryFailedActive = false;
  retryFailedLastResult = {
    reason: reason
  };
  render();
  if (persist) {
    void browser.storage.local.set(_defineProperty({}, COORDINATOR_RETRY_FAILED_ENABLED_KEY, false));
  }
}
function getDisplayQueueItems() {
  return Object.entries(state.queue || {}).map(function (_ref11) {
    var _ref12 = _slicedToArray(_ref11, 2),
      key = _ref12[0],
      item = _ref12[1];
    var source = item && _typeof(item) === 'object' ? item : {};
    return _objectSpread(_objectSpread({}, source), {}, {
      storageKey: key
    });
  });
}
function getQueueItemHref() {
  var key = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var item = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  return "".concat((item === null || item === void 0 ? void 0 : item.targetProfileHref) || (item === null || item === void 0 ? void 0 : item.requestedUrl) || (item === null || item === void 0 ? void 0 : item.dedupeKey) || (item === null || item === void 0 ? void 0 : item.storageKey) || key || '').trim();
}
function getRunTargetHrefs() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Array.isArray(run === null || run === void 0 ? void 0 : run.targetProfileHrefs) ? run.targetProfileHrefs.map(function (href) {
    return "".concat(href || '').trim();
  }).filter(Boolean) : [];
}
function getRunQueueItems() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var runId = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var run = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var targetHrefs = new Set(getRunTargetHrefs(run));
  return queueItems.filter(function (item) {
    if ((item === null || item === void 0 ? void 0 : item.runId) === runId) return true;
    if (!targetHrefs.size) return false;
    return targetHrefs.has(getQueueItemHref('', item));
  });
}
function getDisplayRuns(queueItems) {
  var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var runs = _objectSpread({}, state.runs);
  var runIdsWithQueueItems = new Set();
  var hiddenRunIds = new Set(options.includeHidden ? [] : state.hiddenRunIds || []);
  var candidateRunIds = new Set(Object.keys(runs));
  var _iterator2 = _createForOfIteratorHelper(queueItems),
    _step2;
  try {
    for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
      var item = _step2.value;
      var runId = (item === null || item === void 0 ? void 0 : item.runId) || '';
      if (!runId) continue;
      candidateRunIds.add(runId);
    }
  } catch (err) {
    _iterator2.e(err);
  } finally {
    _iterator2.f();
  }
  var _iterator3 = _createForOfIteratorHelper(candidateRunIds),
    _step3;
  try {
    for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
      var _runId = _step3.value;
      var existing = runs[_runId] || {
        id: _runId,
        sourceType: 'space-feed',
        createdAt: 0,
        updatedAt: 0,
        status: 'running',
        sourcePages: []
      };
      var runItems = getRunQueueItems(queueItems, _runId, existing);
      var targetHrefs = getRunTargetHrefs(existing);
      var displayTargetHrefs = targetHrefs.length ? targetHrefs : runItems.map(function (item) {
        return getQueueItemHref('', item);
      }).filter(Boolean);
      if (!runItems.length && !targetHrefs.length) continue;
      runIdsWithQueueItems.add(_runId);
      var terminalCount = runItems.filter(isTerminalQueueItem).length;
      var activeCount = runItems.filter(isActiveQueueItem).length;
      var latestItemUpdatedAt = runItems.reduce(function (latest, item) {
        var updatedAt = Number.parseInt(item.updatedAt || item.createdAt, 10) || 0;
        return Math.max(latest, updatedAt);
      }, 0);
      runs[_runId] = _objectSpread(_objectSpread({}, existing), {}, {
        itemCount: targetHrefs.length || runItems.length,
        activeCount: activeCount,
        terminalCount: terminalCount,
        status: runItems.length > 0 && terminalCount === runItems.length ? 'empty' : existing.status || 'running',
        submittedAt: getRunSubmitTime(_runId, existing),
        updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt),
        displayTargetProfileHrefs: displayTargetHrefs
      });
    }
  } catch (err) {
    _iterator3.e(err);
  } finally {
    _iterator3.f();
  }
  return Object.values(runs).filter(function (run) {
    return runIdsWithQueueItems.has((run === null || run === void 0 ? void 0 : run.id) || (run === null || run === void 0 ? void 0 : run.runId) || '');
  }).filter(function (run) {
    return !hiddenRunIds.has((run === null || run === void 0 ? void 0 : run.id) || (run === null || run === void 0 ? void 0 : run.runId) || '');
  }).map(function (run) {
    return _objectSpread(_objectSpread({}, run), {}, {
      submittedAt: getRunSubmitTime((run === null || run === void 0 ? void 0 : run.id) || (run === null || run === void 0 ? void 0 : run.runId) || '', run)
    });
  });
}
function isTerminalQueueItem(item) {
  return isTerminalQueueStatus(item === null || item === void 0 ? void 0 : item.status);
}
function isTerminalQueueStatus() {
  var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  return isTerminalCoordinatorStatus(status);
}
function isActiveQueueItem() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return isActiveCoordinatorStatus(item === null || item === void 0 ? void 0 : item.status);
}
function isActualBlockSuccess() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if ("".concat((item === null || item === void 0 ? void 0 : item.status) || '') !== 'succeeded') return false;
  if ("".concat((item === null || item === void 0 ? void 0 : item.outcome) || '') === 'already-blocked') return false;
  if ("".concat((item === null || item === void 0 ? void 0 : item.outcome) || '') === 'blocked') return true;
  var milestones = (item === null || item === void 0 ? void 0 : item.milestones) || {};
  return Number.parseInt((item === null || item === void 0 ? void 0 : item.blockAttemptedAt) || milestones.blockAttemptedAt, 10) > 0;
}

// The exact complement of isActualBlockSuccess's already-blocked exclusion
// -- see the matching pair in swCoordinatorQueueView.js.
function isAlreadyBlockedSuccess() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if ("".concat((item === null || item === void 0 ? void 0 : item.status) || '') !== 'succeeded') return false;
  return "".concat((item === null || item === void 0 ? void 0 : item.outcome) || '') === 'already-blocked';
}
function getCurrentMetricsEpochStartedAt() {
  var metrics = state.metrics || {};
  var currentEpoch = metrics.currentEpoch || metrics;
  return Number.parseInt(currentEpoch.startedAt, 10) || 0;
}
function getCurrentMetricsEpoch() {
  var metrics = state.metrics || {};
  return metrics.currentEpoch || metrics;
}
function getCurrentMetricsCounter() {
  var name = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var counters = getCurrentMetricsEpoch().counters || {};
  return Number.parseInt(counters[name], 10) || 0;
}
function setQuoraVisitRequirement() {
  var required = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
  if (required) {
    if (!state.requiresQuoraVisit) {
      state.requiresQuoraVisitAt = Date.now();
    }
    state.requiresQuoraVisit = true;
    state.quoraActivationCounterBaseline = 0;
    state.quoraActivationMetricBaselineKnown = false;
    return;
  }
  state.requiresQuoraVisit = false;
  state.requiresQuoraVisitAt = 0;
  state.quoraActivationCounterBaseline = 0;
  state.quoraActivationMetricBaselineKnown = false;
}
function captureQuoraActivationMetricBaseline() {
  if (!state.requiresQuoraVisit) return;
  state.quoraActivationCounterBaseline = getCurrentMetricsCounter('runtime.quoraActivated');
  state.quoraActivationMetricBaselineKnown = true;
}
function hasCurrentEpochQuoraActivationMetric() {
  if (state.requiresQuoraVisit && state.quoraActivationMetricBaselineKnown) {
    var counter = getCurrentMetricsCounter('runtime.quoraActivated');
    if (counter > state.quoraActivationCounterBaseline) return true;
  } else if (!state.requiresQuoraVisit && getCurrentMetricsCounter('runtime.quoraActivated') > 0) {
    return true;
  }
  var journal = Array.isArray(getCurrentMetricsEpoch().journal) ? getCurrentMetricsEpoch().journal : [];
  var minimumActivationAt = state.requiresQuoraVisit ? Number.parseInt(state.requiresQuoraVisitAt, 10) || 0 : 0;
  return journal.some(function (entry) {
    if ("".concat((entry === null || entry === void 0 ? void 0 : entry.name) || '') !== 'quora-runtime-activated') return false;
    var activatedAt = Number.parseInt(entry === null || entry === void 0 ? void 0 : entry.at, 10) || 0;
    return !minimumActivationAt || activatedAt >= minimumActivationAt;
  });
}
function getQueueItemActivityTime() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Math.max(Number.parseInt(item.updatedAt, 10) || 0, Number.parseInt(item.activeAt, 10) || 0, Number.parseInt(item.terminalAt, 10) || 0, Number.parseInt(item.createdAt, 10) || 0, Number.parseInt(item.queuedAt, 10) || 0);
}
function hasFreshActiveQueueWork() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = getCurrentMetricsEpochStartedAt();
  return queueItems.some(function (item) {
    if (!isActiveQueueItem(item)) return false;
    var activityAt = getQueueItemActivityTime(item);
    return !epochStartedAt || activityAt >= epochStartedAt;
  });
}
function hasFreshTerminalQueueWork() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = getCurrentMetricsEpochStartedAt();
  return queueItems.some(function (item) {
    if (!isTerminalQueueItem(item)) return false;
    var activityAt = getQueueItemActivityTime(item);
    return !epochStartedAt || activityAt >= epochStartedAt;
  });
}
function hasCurrentEpochTerminalJobMetric() {
  return getCurrentMetricsCounter('job.terminal') > 0;
}
function hasSatisfiedQuoraVisitEvidence() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  return hasCurrentEpochQuoraActivationMetric() || hasFreshActiveQueueWork(queueItems) || hasFreshTerminalQueueWork(queueItems) || hasCurrentEpochTerminalJobMetric();
}
function refreshQuoraVisitRequirement() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  if (state.requiresQuoraVisit && hasSatisfiedQuoraVisitEvidence(queueItems)) {
    setQuoraVisitRequirement(false);
  }
}

// Shared by getSecondsPerActualBlock ("secs / real block") and
// getSecondsPerAlreadyBlocked ("secs / already blocked") -- same
// sampling/outlier/epoch-floor fallback logic (used only when the
// service-worker-provided queueView summary is unavailable), differing
// only in which predicate selects the completed rows.
function getSecondsPerBlockLike() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var matchesSuccess = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {
    return false;
  };
  // 2026-09-27: floored by epochStartedAt again -- see the matching
  // comment on summarizeCoordinatorActualBlockTiming in
  // swCoordinatorQueueView.js for why (epochStartedAt only moves on a
  // deliberate reset, and this card should read "fresh" right after one).
  var minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0;
  var completed = queueItems.filter(function (item) {
    if (!matchesSuccess(item)) return false;
    var terminalAt = getQueueItemTerminalTime(item);
    return terminalAt > 0 && terminalAt >= minimumTerminalAt;
  }).sort(function (left, right) {
    return getQueueItemTerminalTime(right) - getQueueItemTerminalTime(left);
  }).slice(0, SECONDS_PER_BLOCK_SAMPLE_LIMIT);
  if (!completed.length) return null;
  var durations = completed.map(getQueueItemActiveDurationMs).filter(function (duration) {
    return duration > 0 && duration <= TIMING_SAMPLE_MAX_PLAUSIBLE_MS;
  });
  if (!durations.length) return null;
  var totalDurationMs = durations.reduce(function (total, duration) {
    return total + duration;
  }, 0);
  return {
    seconds: totalDurationMs / 1000 / durations.length,
    blocks: durations.length,
    elapsedMs: totalDurationMs
  };
}
function getSecondsPerActualBlock() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var viewResult = getQueueViewSecondsPerActualBlock(epochStartedAt);
  if (viewResult) return viewResult;
  return getSecondsPerBlockLike(queueItems, epochStartedAt, isActualBlockSuccess);
}
function getSecondsPerAlreadyBlocked() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var viewResult = getQueueViewSecondsPerAlreadyBlocked(epochStartedAt);
  if (viewResult) return viewResult;
  return getSecondsPerBlockLike(queueItems, epochStartedAt, isAlreadyBlockedSuccess);
}

// Shared by the queueView-summary readers below (real block, already
// blocked, handoff) -- each SW-provided summary object carries its own
// epochStartedAt (for the same-epoch-only check) and count under a
// differently-named field (blocks vs handoffs), passed in as countField.
function getQueueViewTimingSummarySeconds() {
  var summary = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var countField = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'blocks';
  if (!summary || _typeof(summary) !== 'object') return null;
  var requestedEpochStartedAt = Number.parseInt(epochStartedAt, 10) || 0;
  var summaryEpochStartedAt = Number.parseInt(summary.epochStartedAt, 10) || 0;
  if (requestedEpochStartedAt && summaryEpochStartedAt && summaryEpochStartedAt !== requestedEpochStartedAt) return null;
  var blocks = Number.parseInt(summary[countField], 10) || 0;
  var elapsedMs = Number.parseInt(summary.elapsedMs, 10) || 0;
  var seconds = Number(summary.seconds);
  if (blocks <= 0 || elapsedMs <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    seconds: seconds,
    blocks: blocks,
    elapsedMs: elapsedMs
  };
}
function getQueueViewSecondsPerActualBlock() {
  var _state$queueView2;
  var epochStartedAt = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  return getQueueViewTimingSummarySeconds((_state$queueView2 = state.queueView) === null || _state$queueView2 === void 0 ? void 0 : _state$queueView2.actualBlockTiming, epochStartedAt, 'blocks');
}
function getQueueViewSecondsPerAlreadyBlocked() {
  var _state$queueView3;
  var epochStartedAt = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  return getQueueViewTimingSummarySeconds((_state$queueView3 = state.queueView) === null || _state$queueView3 === void 0 ? void 0 : _state$queueView3.alreadyBlockedTiming, epochStartedAt, 'blocks');
}
function getActivationHandoffSeconds() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var viewResult = getQueueViewActivationHandoffSeconds(epochStartedAt);
  if (viewResult) return viewResult;
  var minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0;
  var activations = queueItems.map(function (item) {
    return {
      item: item,
      key: (item === null || item === void 0 ? void 0 : item.storageKey) || (item === null || item === void 0 ? void 0 : item.targetProfileHref) || (item === null || item === void 0 ? void 0 : item.requestedUrl) || '',
      runId: "".concat((item === null || item === void 0 ? void 0 : item.runId) || '').trim(),
      activeAt: Number.parseInt(item === null || item === void 0 ? void 0 : item.activeAt, 10) || 0
    };
  }).filter(function (sample) {
    return sample.activeAt > 0 && sample.runId;
  }).sort(function (left, right) {
    return left.activeAt - right.activeAt;
  });
  var terminals = queueItems.map(function (item) {
    return {
      item: item,
      key: (item === null || item === void 0 ? void 0 : item.storageKey) || (item === null || item === void 0 ? void 0 : item.targetProfileHref) || (item === null || item === void 0 ? void 0 : item.requestedUrl) || '',
      runId: "".concat((item === null || item === void 0 ? void 0 : item.runId) || '').trim(),
      terminalAt: getQueueItemTerminalTime(item)
    };
  }).filter(function (sample) {
    if (!isTerminalQueueItem(sample.item)) return false;
    // Floored by epochStartedAt again -- see getSecondsPerActualBlock above.
    return sample.runId && sample.terminalAt > 0 && sample.terminalAt >= minimumTerminalAt;
  }).sort(function (left, right) {
    return left.terminalAt - right.terminalAt;
  });
  var gaps = [];
  var _iterator4 = _createForOfIteratorHelper(terminals),
    _step4;
  try {
    var _loop = function _loop() {
      var terminal = _step4.value;
      var nextActivation = activations.find(function (candidate) {
        return candidate.key !== terminal.key && candidate.runId === terminal.runId && candidate.activeAt > terminal.terminalAt;
      });
      if (nextActivation) {
        var gapMs = nextActivation.activeAt - terminal.terminalAt;
        if (gapMs > 0 && gapMs <= TIMING_SAMPLE_MAX_PLAUSIBLE_MS) gaps.push(gapMs);
      }
      if (gaps.length >= SECONDS_PER_BLOCK_SAMPLE_LIMIT) return 1; // break
    };
    for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
      if (_loop()) break;
    }
  } catch (err) {
    _iterator4.e(err);
  } finally {
    _iterator4.f();
  }
  if (!gaps.length) return null;
  var elapsedMs = gaps.reduce(function (total, gap) {
    return total + gap;
  }, 0);
  return {
    seconds: elapsedMs / 1000 / gaps.length,
    blocks: gaps.length,
    elapsedMs: elapsedMs
  };
}
function getQueueViewActivationHandoffSeconds() {
  var _state$queueView4;
  var epochStartedAt = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  return getQueueViewTimingSummarySeconds((_state$queueView4 = state.queueView) === null || _state$queueView4 === void 0 ? void 0 : _state$queueView4.activationHandoffTiming, epochStartedAt, 'handoffs');
}
function getQueueItemActiveStartTime() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Number.parseInt(item === null || item === void 0 ? void 0 : item.activeAt, 10) || 0;
}
function getQueueItemTerminalTime() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return Number.parseInt((item === null || item === void 0 ? void 0 : item.terminalAt) || (item === null || item === void 0 ? void 0 : item.blockedAt) || (item === null || item === void 0 ? void 0 : item.updatedAt) || (item === null || item === void 0 ? void 0 : item.createdAt), 10) || 0;
}
function getQueueItemActiveDurationMs() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var startedAt = getQueueItemActiveStartTime(item);
  var endedAt = getQueueItemTerminalTime(item);
  return startedAt > 0 && endedAt > startedAt ? endedAt - startedAt : 0;
}
function formatSecondsPerBlock() {
  var result = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!result) return '--';
  var seconds = Number(result.seconds);
  if (!Number.isFinite(seconds)) return '--';
  if (seconds >= 100) return "".concat(Math.round(seconds));
  if (seconds >= 10) return seconds.toFixed(1);
  return seconds.toFixed(2);
}
function isPendingQueueStatus() {
  var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  return isPendingCoordinatorStatus(status);
}
function setText(id, value) {
  var element = document.getElementById(id);
  if (element) element.textContent = "".concat(value);
}
function getRefreshStateText() {
  if (state.loading) return 'Loading history...';
  if (state.loadError) return 'History load failed';
  if (state.requiresQuoraVisit) {
    var queuedCount = getQueuedCoordinatorQueueCount();
    return queuedCount > 0 ? "Waiting for first Quora page (".concat(queuedCount, " queued)") : 'Waiting for first Quora page';
  }
  var throttle = getCurrentQueueLoadThrottle();
  if (throttle.active) {
    var retryIn = Math.max(0, (Number.parseInt(throttle.until, 10) || 0) - Date.now());
    return "Quora slow: throttled to 1 tab, retrying in ".concat(formatDuration(retryIn));
  }
  return "Updated ".concat(formatTime(Date.now()));
}
function getCurrentQueueLoadThrottle() {
  var metrics = state.metrics || {};
  var currentEpoch = metrics.currentEpoch || metrics;
  var throttle = currentEpoch.queueLoadThrottle || {};
  var until = Number.parseInt(throttle.until, 10) || 0;
  var level = Number.parseInt(throttle.level, 10) || 0;
  return _objectSpread(_objectSpread({}, throttle), {}, {
    active: throttle.active === true && level > 0 && until > Date.now(),
    level: level,
    until: until
  });
}

// The server's run status is a deliberately small 3-state rollup --
// 'running'/'paused'/'empty' -- where 'empty' means "nothing left to do in
// this run" regardless of whether that's because every item succeeded or
// the run never had any items (see getCoordinatorRunStatus's own comment;
// "Clear Completed" above relies on exactly that single value to find
// everything it should hide). Showing that raw label on a 494-item run that
// fully succeeded reads as if the run lost its items, not that it finished
// -- this only affects the displayed badge text, not the underlying status
// value anything else here keys off of.
function getRunStatusLabel() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var status = "".concat((run === null || run === void 0 ? void 0 : run.status) || '').trim() || 'unknown';
  if (status !== 'empty') return status;
  return (Number.parseInt(run === null || run === void 0 ? void 0 : run.itemCount, 10) || 0) > 0 ? 'done' : 'empty';
}
function renderRuns(runs) {
  var container = document.getElementById('runList');
  if (!container) return;
  var sortedRuns = _toConsumableArray(runs).sort(function (left, right) {
    return getRunSubmitTime((right === null || right === void 0 ? void 0 : right.id) || (right === null || right === void 0 ? void 0 : right.runId) || '', right) - getRunSubmitTime((left === null || left === void 0 ? void 0 : left.id) || (left === null || left === void 0 ? void 0 : left.runId) || '', left);
  });
  replaceChildren(container, sortedRuns.map(function (run) {
    var runId = run.id || run.runId || '';
    var submittedAt = getRunSubmitTime(runId, run);
    var runDisplay = getRunDisplay(run);
    var row = document.createElement('div');
    row.className = 'row';
    row.append(buildTitleCell(runDisplay.title, runDisplay.subtitle, {
      titleHref: runDisplay.titleHref,
      title: runId
    }), buildBadge(getRunStatusLabel(run)), buildTextCell("".concat(Number.parseInt(run.itemCount, 10) || 0, " items")), buildTextCell(submittedAt ? formatDateTime(submittedAt) : ''));
    return row;
  }), state.loading ? 'Loading history...' : 'No dashboard runs yet.');
}
function renderEvents() {
  var container = document.getElementById('eventList');
  if (!container) return;
  var sortedEvents = _toConsumableArray(state.events).sort(function (left, right) {
    return getTime(right) - getTime(left);
  });
  replaceChildren(container, sortedEvents.map(function (event) {
    var eventDisplay = getEventDisplay(event);
    var row = document.createElement('div');
    row.className = 'row row--event';
    row.append(buildTitleCell(event.message || event.type || 'Event', eventDisplay.subtitle, {
      subtitleHref: eventDisplay.subtitleHref,
      title: event.runId || ''
    }), buildBadge(event.type || 'event'), buildTextCell(formatEventDetails(event)), buildTextCell(formatDateTime(event.at)));
    return row;
  }), state.loading ? 'Loading history...' : 'No dashboard events.');
}
function renderWakeupMetrics() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var metricsGrid = document.getElementById('metricsGrid');
  var journal = document.getElementById('metricsJournal');
  var metricsDocument = state.metrics || {};
  var metrics = metricsDocument.currentEpoch || metricsDocument;
  var counters = metrics.counters || {};
  var phases = metrics.phases || {};
  var entries = Array.isArray(metrics.journal) ? metrics.journal : [];
  var previousEpochs = Array.isArray(metricsDocument.previousEpochs) ? metricsDocument.previousEpochs : [];
  var throttle = getCurrentQueueLoadThrottle();
  var jobs = getMetricCounter(counters, 'job.enqueued');
  var terminalJobs = getMetricCounter(counters, 'job.terminal');
  var nudgeSent = getMetricCounter(counters, 'nudge.sent');
  var nudgeAccepted = getMetricCounter(counters, 'nudge.accepted');
  // 2026-09-27: nudge.sent increments on every nudgeQueuedTabActionClaim
  // call, including ones the coalesce cooldown (isKeyedThrottleCoalesced)
  // skips before actually messaging a tab -- confirmed live at 444
  // coalesced out of 749 "sent," each one an intentional, expected skip
  // (there was already a nudge outstanding for that tab), not a failure.
  // Dividing accepted by the full sent count made a healthy run look
  // like it was only accepting ~31% of nudges, when the real rate among
  // nudges that actually went out was much higher. nudgeDispatched
  // backs those out of the denominator.
  var nudgeCoalesced = getMetricCounter(counters, 'nudge.coalesced');
  var nudgeDispatched = Math.max(0, nudgeSent - nudgeCoalesced);
  var pumpRequested = getMetricCounter(counters, 'pump.requested');
  var pumpChanged = sumMetricCounters(counters, 'pump.changed.');
  var reconcileRequested = getMetricCounter(counters, 'reconcile.requested');
  var reconcileChanged = sumMetricCounters(counters, 'reconcile.changed.');
  var storageStarted = getMetricCounter(counters, 'storageUpdate.started');
  var storageTimedOut = getMetricCounter(counters, 'storageUpdate.timedOut');
  var storageDeadlineMissed = getMetricCounter(counters, 'storageUpdate.deadlineMissed');
  var storageFallbackReturned = getMetricCounter(counters, 'storageUpdate.fallbackReturned');
  var storageNoRuntimeWork = getMetricCounter(counters, 'storageUpdate.noRuntimeWork');
  var storageNoDurableWork = getMetricCounter(counters, 'storageUpdate.noDurableWork');
  var storageTimeoutGet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageGet');
  var storageTimeoutSet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageSet');
  var storageTimeoutUnknown = getMetricCounter(counters, 'storageUpdate.timeout.unknown');
  var storageQueueStallWarnings = getMetricCounter(counters, 'storageUpdate.queueStallWarning');
  var storageQueueStallMaxWaitMs = getMetricCounter(counters, 'storageUpdate.queueStallMaxWaitMs');
  var milestoneReceived = getMetricCounter(counters, 'milestone.received');
  var milestoneFlushes = getMetricCounter(counters, 'milestone.flushPerformed');
  var progressReceived = getMetricCounter(counters, 'progress.recordReceived');
  var progressPendingMax = getMetricCounter(counters, 'progress.pendingMax');
  var progressPendingMaxTrend = previousProgressPendingMax === null ? null : progressPendingMax > previousProgressPendingMax ? 'up' : progressPendingMax < previousProgressPendingMax ? 'down' : null;
  previousProgressPendingMax = progressPendingMax;
  var payloadBytes = getMetricCounter(counters, 'storagePayload.write.total.bytes');
  var payloadCalls = getMetricCounter(counters, 'storagePayload.write.total.calls');
  var payloadQueueBytes = getMetricCounter(counters, 'storagePayload.write.queue.bytes');
  var payloadRunsBytes = getMetricCounter(counters, 'storagePayload.write.runs.bytes');
  var payloadProgressBytes = getMetricCounter(counters, 'storagePayload.write.progress.bytes');
  var payloadQueueViewBytes = getMetricCounter(counters, 'storagePayload.write.queueView.bytes');
  var payloadMaxBytes = getMetricCounter(counters, 'storagePayload.write.total.maxBytes');
  var queueViewWriteCalls = getMetricCounter(counters, 'storagePayload.write.queueView.latencyCalls');
  var queueViewWriteLatencyMsSum = getMetricCounter(counters, 'storagePayload.write.queueView.latencyMsSum');
  var queueViewWriteMaxLatencyMs = getMetricCounter(counters, 'storagePayload.write.queueView.maxLatencyMs');
  var readBytes = getMetricCounter(counters, 'storagePayload.read.total.bytes');
  var readCalls = getMetricCounter(counters, 'storagePayload.read.total.calls');
  var readQueueBytes = getMetricCounter(counters, 'storagePayload.read.queue.bytes');
  var readQueueViewBytes = getMetricCounter(counters, 'storagePayload.read.queueView.bytes');
  var readProgressBytes = getMetricCounter(counters, 'storagePayload.read.progress.bytes');
  var readMaxBytes = getMetricCounter(counters, 'storagePayload.read.total.maxBytes');
  var topReadPath = getTopStoragePayloadPath(counters, 'read');
  var topWritePath = getTopStoragePayloadPath(counters, 'write');
  var cloudflareChallenges = getMetricCounter(counters, 'cloudflareChallenge.detected');
  // 2026-09-27: instrumentation for the queued-row self-healing check
  // (a queued row whose durable progress record already shows terminal,
  // settled back in runCoordinatorExecutorApplyPhase's per-tick loop) --
  // added to measure how often it actually fires before deciding whether
  // it's worth moving off the hot per-tick loop onto a slower periodic
  // sweep. matched = condition true this tick; settled = matched AND the
  // authority write actually landed.
  var queuedTerminalProgressMatched = getMetricCounter(counters, 'queuedTerminalProgressSettlement.matched');
  var queuedTerminalProgressSettled = getMetricCounter(counters, 'changed.terminalizedQueuedFromTerminalProgress');
  var duplicatePumps = getMetricCounter(counters, 'pump.noop.noPendingItems') + getMetricCounter(counters, 'pump.noop.executorAlreadyRunning') + getMetricCounter(counters, 'pump.noop.paused');
  var wakeups = nudgeSent + pumpRequested + reconcileRequested;
  // Cache-hit vs genuine-read split for the segmented WAL's resident-store
  // cache (this week's fix chain: a dead cache meant every hydrate was a
  // real storage read). residentStoreUsed should dominate once the queue
  // is warm; segmentedHydrated is a true chrome.storage.local read.
  var walResidentStoreUsed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.residentStoreUsed');
  var walSegmentedHydrated = getMetricCounter(counters, 'coordinatorAuthority.queueWal.segmentedHydrated');
  var walCacheAttempts = walResidentStoreUsed + walSegmentedHydrated;
  var storageGetCalls = getMetricCounter(counters, 'storageGetCalls');
  // WAL append/checkpoint-switch frequency (same fix chain: a checkpoint
  // switch folds the WAL's accumulated segments back into a single
  // snapshot). Checkpoint switches are triggered once committed segments
  // reach COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT (128); the hard
  // limit that blocks further appends until one succeeds is
  // COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT (1024).
  var walAppended = getMetricCounter(counters, 'coordinatorAuthority.queueWal.appended');
  var walAppendBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.appendBytes');
  var walCheckpointed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointed');
  var walCheckpointedRecords = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointedRecords');
  var walCheckpointFailed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointFailed');
  // Physical WAL segment writes and checkpoint-switch writes are tracked
  // separately from the logical appended/checkpointed counters above --
  // these are actual chrome.storage.local.set byte sizes for the WAL's
  // on-disk representation, recorded by
  // recordCoordinatorQueueWalPhysicalPayloadMetrics but never surfaced
  // on the dashboard before now.
  var walSegmentWrites = getMetricCounter(counters, 'coordinatorAuthority.queueWal.physicalSegmentWrites');
  var walSegmentBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.physicalSegmentBytes');
  var walSegmentMaxBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.maxPhysicalSegmentBytes');
  var walCheckpointWrites = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointWrites');
  var walCheckpointBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointBytes');
  var walCheckpointMaxBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.maxCheckpointBytes');
  // The durable queue-view snapshot (mbCoordinatorQueueView -- what the
  // dashboard/popup/CDP tools actually read) is written by a SEPARATE,
  // non-atomic storage.set from the WAL append it is supposed to mirror.
  // It can fail independently under load with no guaranteed catch-up
  // deadline (see queue-wal-segmented-record-followup-2026-05-27.md's
  // 2026-09-17 entry) -- projectionSaved/projectionFailed are the only
  // signal that divergence is happening, so surface them directly rather
  // than leaving them buried in raw counters.
  var viewProjectionSaved = getMetricCounter(counters, 'coordinatorAuthority.queueWal.projectionSaved');
  var viewProjectionFailed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.projectionFailed');
  var stalledQueued = queueItems.filter(function (item) {
    return "".concat((item === null || item === void 0 ? void 0 : item.status) || '') === 'queued';
  }).length;
  var epochReason = metrics.resetReason ? ", ".concat(metrics.resetReason) : '';
  var epochStarted = metrics.startedAt ? "Epoch ".concat(formatTime(metrics.startedAt)).concat(epochReason) : 'No metrics yet';
  setText('metricsUpdated', metrics.updatedAt ? "".concat(epochStarted, "; updated ").concat(formatTime(metrics.updatedAt)) : epochStarted);
  if (metricsGrid) {
    replaceChildren(metricsGrid, [buildMetricCard('Current epoch', metrics.resetReason || '--', "".concat(metrics.epochId || ''), {
      title: 'Why the current metrics epoch was reset (extension reload, browser restart, manual reset). Not itself a health signal -- just labels which stretch of history the cards below cover.'
    }), buildMetricCard('Previous epochs', "".concat(previousEpochs.length), formatPreviousEpochSummary(previousEpochs[previousEpochs.length - 1]), {
      title: 'How many prior metrics epochs are retained, and a summary of the most recent one. Concerning only if the prior epoch shows a much worse timeout rate or write volume than the current one -- otherwise this is just history.'
    }), buildMetricCard('Queue throttle', throttle.active ? 'active' : 'idle', throttle.active ? "level ".concat(throttle.level, "; retry ").concat(formatDuration(throttle.until - Date.now()), "; ").concat(throttle.reason || '') : throttle.lastProgressAt ? "recovered ".concat(formatTime(throttle.lastProgressAt)) : 'No page-load throttle active', {
      alert: throttle.active && throttle.level >= 2,
      title: 'Whether the scheduler is deliberately backing off queued-tab activity (e.g. after slow/unscriptable tabs or Cloudflare challenges). Concerning if this stays "active" for more than a couple of QUEUE_LOAD_THROTTLE_MAX_MS windows (120s each, escalating) -- that means whatever tripped it keeps recurring rather than clearing.'
    }), buildMetricCard('Wakeups/job', jobs ? formatRatio(wakeups / jobs) : '--', "".concat(wakeups, " wakeups / ").concat(jobs, " enqueued"), {
      alert: jobs > 0 && wakeups / jobs > 3,
      title: 'Nudges + pump requests + reconciles per enqueued job -- how many scheduler wakeups it takes to move work through the queue. Concerning if this trends well above 2-3x enqueued jobs; that suggests the scheduler is being woken repeatedly without making proportional progress.'
    }), buildMetricCard('Nudge accept', nudgeDispatched ? formatPercent(nudgeAccepted / nudgeDispatched) : '--', "".concat(nudgeAccepted, " / ").concat(nudgeDispatched, " dispatched (").concat(nudgeCoalesced, " coalesced, not counted)"), {
      // 2026-09-29: traced live -- essentially every rejected nudge
      // is a tab/row that already resolved through a different path
      // (closed, or the durable row moved on) by the time the nudge
      // landed, not a stuck/unresponsive tab. A low percentage here
      // is normal queue churn, not a signal of trouble, so this no
      // longer alerts. nudge.failed.message (a tab that responded
      // but errored) is the actual thing worth watching.
      title: 'Share of claim nudges that actually reached a tab (excludes ones the coalesce cooldown skipped before sending) that got accepted. Usually well under 100% even when healthy -- a rejected nudge almost always means the tab or row already resolved through a different path before the nudge arrived, not that something is wrong. Watch nudge.failed.message instead for a tab that responded but errored.'
    }), buildMetricCard('Pump yield', pumpRequested ? formatPercent(pumpChanged / pumpRequested) : '--', "".concat(pumpChanged, " changed / ").concat(pumpRequested), {
      alert: pumpRequested > 0 && stalledQueued > 0 && pumpChanged / pumpRequested < 0.3,
      title: 'Share of executor pump cycles that actually changed something. Concerning if this stays low (lots of no-op pumps) while Queued > 0 -- see Duplicate pumps below for the specific no-op reasons.'
    }), buildMetricCard('Duplicate pumps', pumpRequested ? formatPercent(duplicatePumps / pumpRequested) : '--', "".concat(duplicatePumps, " no-op"), {
      alert: !state.paused && pumpRequested > 0 && duplicatePumps / pumpRequested > 0.7 && pumpChanged / pumpRequested < 0.3,
      title: 'Pump cycles that no-opped because there was nothing pending, the executor was already running, or the queue is paused. Concerning if this is high AND Pump yield is low AND the queue is not paused -- that combination means pumps are being requested faster than there is new work to justify them.'
    }), buildMetricCard('Reconciles/job', jobs ? formatRatio(reconcileRequested / jobs) : '--', "".concat(reconcileChanged, " reconcile changes"), {
      title: 'Reconcile passes (the periodic sweep that repairs drifted/stuck rows) per enqueued job. Concerning if this climbs steadily -- COORDINATOR_RECONCILE_BACKOFF_MAX_MS (60s) is the ceiling between reconciles once backed off, so a high rate here means something keeps re-triggering reconcile at its minimum interval instead of backing off.'
    }), buildMetricCard('Terminal jobs', "".concat(terminalJobs), "".concat(stalledQueued, " currently queued"), {
      title: 'Total jobs that reached a terminal state (succeeded/failed/skipped/canceled) this epoch, plus how many are still queued right now. Not concerning on its own -- cross-check against Really/Already blocked and the failed-row badges for what those terminal jobs actually were.'
    }), buildMetricCard('Queued self-heal', "".concat(queuedTerminalProgressMatched), "".concat(queuedTerminalProgressSettled, " settled"), {
      title: 'How often a queued row\'s own durable progress record already showed terminal (the row\'s live queue status just hadn\'t caught up yet), checked on every executor-apply tick. Purely observational for now -- this decides whether it\'s worth moving off the hot per-tick loop onto a slower periodic sweep instead. A near-zero count here means that move would buy little; a high, steadily climbing count means it would.'
    }), buildMetricCard('Cloudflare challenges', "".concat(cloudflareChallenges), jobs ? "".concat(formatPercent(cloudflareChallenges / jobs), " of ").concat(jobs, " enqueued jobs hit a bot-challenge interstitial") : 'No challenge interstitials seen yet', {
      alert: cloudflareChallenges > 1,
      title: 'Profile loads that hit a Cloudflare bot-challenge interstitial instead of the real page. Concerning at any sustained rate above isolated one-offs -- each one also trips the queue-load throttle, so a rising count here explains a queue that keeps backing off.'
    }), buildMetricCard('Queue -> tab', formatPhaseAverage(phases.durableQueueToTabOpen), formatPhaseDetail(phases.durableQueueToTabOpen), {
      // Half of the tighter of the two staleness windows this
      // phase approaches (QUEUED_TAB_CREATE_TIMEOUT_MS 10s).
      alert: getPhaseAverageMs(phases.durableQueueToTabOpen) >= 5000,
      title: 'Time from a row becoming durably queued to its tab actually opening. Concerning if the average approaches this project\'s queued-tab-open staleness windows (STALE_BACKGROUND_OPENING_QUEUED_TAB_MS 20s, QUEUED_TAB_CREATE_TIMEOUT_MS 10s) -- rows that slow to open that tab are the ones that end up reclaimed as stale.'
    }), buildMetricCard('Tab -> claim', formatPhaseAverage(phases.tabOpenToClaimAccepted), formatPhaseDetail(phases.tabOpenToClaimAccepted), {
      // Half of QUEUED_TAB_CONTENT_ACTOR_READINESS_WINDOW_MS / QUEUED_TAB_DURABLE_CLAIM_TIMEOUT_MS (both 15s).
      alert: getPhaseAverageMs(phases.tabOpenToClaimAccepted) >= 7500,
      title: 'Time from tab open to the content script\'s action claim being accepted. Concerning if the average approaches QUEUED_TAB_CONTENT_ACTOR_READINESS_WINDOW_MS (15s) or QUEUED_TAB_DURABLE_CLAIM_TIMEOUT_MS (15s) -- both are staleness/timeout windows keyed to roughly this transition.'
    }), buildMetricCard('Claim -> action', formatPhaseAverage(phases.claimAcceptedToActionStart), formatPhaseDetail(phases.claimAcceptedToActionStart), {
      // Half of STALE_ACTIVE_ACTION_QUEUED_TAB_MS (30s).
      alert: getPhaseAverageMs(phases.claimAcceptedToActionStart) >= 15000,
      title: 'Time from claim accepted to the mute/block action actually starting. Concerning if the average approaches STALE_ACTIVE_ACTION_QUEUED_TAB_MS (30s) -- that\'s this project\'s threshold for treating an active-action tab as stalled.'
    }), buildMetricCard('Action -> terminal', formatPhaseAverage(phases.actionStartToTerminal), formatPhaseDetail(phases.actionStartToTerminal), {
      // Half of the tighter of COORDINATOR_ACTIVE_JOB_MAX_MS (45s) / COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS (60s).
      alert: getPhaseAverageMs(phases.actionStartToTerminal) >= 22500,
      title: 'Time from the action starting to the row reaching a terminal state. Concerning if the average approaches COORDINATOR_ACTIVE_JOB_MAX_MS (45s) or COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS (60s) -- both bound how long this project lets a job stay active before treating it as stuck.'
    }), buildMetricCard('Terminal -> release', formatPhaseAverage(phases.terminalToSlotRelease), formatPhaseDetail(phases.terminalToSlotRelease), {
      // Half of TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS (2.5s).
      alert: getPhaseAverageMs(phases.terminalToSlotRelease) >= 1250,
      title: 'Time from a row going terminal to its worker slot actually being released for reuse. Concerning if the average approaches TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS (2.5s) -- slow releases here are the direct cause of a rising "secs / handoff" summary tile above.'
    }), buildMetricCard('Storage timeouts', storageStarted ? formatPercent(storageTimedOut / storageStarted) : "".concat(storageTimedOut), "".concat(storageTimedOut, " / ").concat(storageStarted, "; ").concat(storageFallbackReturned, " fallback returned"), {
      alert: storageTimedOut > 0,
      title: 'Share of durable storage updates that timed out before completing. Concerning at any sustained nonzero rate -- a timed-out update falls back to a stale read/no-op rather than the intended mutation, which is exactly the class of bug behind this week\'s WAL hydrate fixes.'
    }), buildMetricCard('Storage deadlines', storageStarted ? formatPercent(storageDeadlineMissed / storageStarted) : "".concat(storageDeadlineMissed), "".concat(storageDeadlineMissed, " missed; ").concat(getMetricCounter(counters, 'storageUpdate.lateWriteSuppressed'), " late suppressed"), {
      alert: storageDeadlineMissed > 0,
      title: 'Storage updates that missed their intended deadline (whether or not they eventually timed out outright). Concerning if this is nonzero and growing -- it is an early symptom of the same write-queue backlog the "Write queue backlog" card below alerts on directly.'
    }), buildMetricCard('Write queue backlog', storageQueueStallWarnings ? "".concat(storageQueueStallWarnings, " alert").concat(storageQueueStallWarnings === 1 ? '' : 's') : 'clear', storageQueueStallWarnings ? "Oldest pending write waited up to ".concat(formatDuration(storageQueueStallMaxWaitMs), " this epoch") : 'No sustained storage-update backlog this epoch', {
      alert: storageQueueStallWarnings > 0,
      title: 'Fires once the oldest pending durable write has waited at least COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s), checked every COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_CHECK_INTERVAL_MS (15s). Any alert here is concerning by definition -- it is this project\'s own self-imposed threshold for "the serialized storage-update queue is backing up," added after a live incident where a runaway reconcile loop backed it up for minutes.'
    }), buildMetricCard('Timeout buckets', "".concat(storageTimeoutGet), "get ".concat(storageTimeoutGet, ", set ").concat(storageTimeoutSet, ", unknown ").concat(storageTimeoutUnknown), {
      alert: storageTimeoutGet + storageTimeoutSet + storageTimeoutUnknown > 0 && storageTimeoutUnknown / (storageTimeoutGet + storageTimeoutSet + storageTimeoutUnknown) > 0.5,
      title: 'Breaks Storage timeouts down by where in the read/write cycle they happened. Concerning if "unknown" is a large share -- that means a timeout is happening somewhere this breakdown can\'t attribute, which is itself worth investigating.'
    }), buildMetricCard('No-work writes', "".concat(storageNoDurableWork), "".concat(storageNoRuntimeWork, " no runtime; ").concat(storageNoDurableWork, " no durable"), {
      // 2026-09-27: a paused queue (or one with nothing pending)
      // legitimately racks up "no durable work" cycles just from
      // periodic polling and reconcile ticks -- that's expected,
      // not a problem, and lighting this up red while paused was
      // actively misleading (confirmed live: a several-hour idle
      // stretch with the dashboard open drove this to a high
      // ratio on its own, via the dashboard poll fixed above).
      // Only alert when the queue is actually supposed to be
      // busy.
      alert: !state.paused && storageStarted > 0 && storageNoDurableWork / storageStarted > 0.5,
      title: 'Storage updates that ran and found nothing durable to persist. Expect a high share of these whenever the queue is paused or has nothing pending -- that alone drives this up with no problem behind it. Concerning only while the queue is actually running and this still dominates total storage updates, since each one still pays the full serialized-queue cost for no benefit.'
    }), buildMetricCard('Storage queue wait', formatPhaseAverage(phases.storageQueueWait), formatPhaseDetail(phases.storageQueueWait), {
      // Half of COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s).
      alert: getPhaseAverageMs(phases.storageQueueWait) >= 15000,
      title: 'Average time a storage update spent waiting in the serialized queue before it got to run. Concerning if this rises toward COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s) -- that\'s the same threshold "Write queue backlog" alerts on for the single oldest pending write.'
    }), buildMetricCard('Storage get', formatPhaseAverage(phases.storageGet), "".concat(storageGetCalls, " calls"), {
      title: 'Average latency of a chrome.storage.local.get call, and how many were made this epoch. Concerning if the call count keeps climbing well past startup with the queue otherwise idle -- see the Queue cache hit rate card, which answers exactly that "are we still re-reading needlessly" question directly.'
    }), buildMetricCard('Storage set', formatPhaseAverage(phases.storageSet), "".concat(getMetricCounter(counters, 'storageSetCalls'), " calls"), {
      title: 'Average latency of a chrome.storage.local.set call, and how many were made this epoch. Concerning if the average latency climbs alongside growing write payload sizes (see Payload avg) -- that\'s consistent with the queue snapshot itself getting large enough to slow every write.'
    }), buildMetricCard('Queue cache hit rate', walCacheAttempts ? formatPercent(walResidentStoreUsed / walCacheAttempts) : '--', "".concat(walResidentStoreUsed, " resident-store hits / ").concat(walSegmentedHydrated, " genuine storage reads (").concat(storageGetCalls, " storage.get calls total)"), {
      alert: walCacheAttempts > 5 && walResidentStoreUsed / walCacheAttempts < 0.5,
      title: 'Of the segmented WAL\'s hydrate attempts, the share served from the in-memory resident-store cache (residentStoreUsed) rather than a real chrome.storage.local read (segmentedHydrated). This week\'s fix chain found this cache dead (residentStoreUsed sat at 0) -- concerning if this rate is low or falling after startup, since reads should be rare once the queue is warm and resident.'
    }), buildMetricCard('WAL writes', "".concat(walAppended), "".concat(formatBytes(walAppendBytes), " appended; ").concat(walCheckpointed, " checkpoint switch").concat(walCheckpointed === 1 ? '' : 'es', " folding in ").concat(walCheckpointedRecords, " record").concat(walCheckpointedRecords === 1 ? '' : 's').concat(walCheckpointFailed ? "; ".concat(walCheckpointFailed, " checkpoint failure").concat(walCheckpointFailed === 1 ? '' : 's') : ''), {
      alert: walCheckpointFailed > 0,
      title: 'How often the coordinator queue\'s write-ahead log is appended to, and how often it checkpoint-switches (folds accumulated segments back into one snapshot). A checkpoint switch is expected roughly every COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT (128) committed segments; concerning if switches are far less frequent than that under heavy write volume (segments piling up toward the COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT of 1024, which blocks further appends) or if any checkpoint failures show up at all.'
    }), buildMetricCard('WAL segment writes', "".concat(walSegmentWrites), "".concat(formatBytes(walSegmentBytes), " written; max ").concat(formatBytes(walSegmentMaxBytes)), {
      title: 'Physical chrome.storage.local writes to WAL segment keys (mbCoordinatorQueueWal.segment.*) -- the incremental append-side storage cost, separate from the logical "WAL writes" append count above. Concerning if the per-write size trends upward over a session; segments should stay small individually until a checkpoint switch folds them back down.'
    }), buildMetricCard('Checkpoint writes', "".concat(walCheckpointWrites), "".concat(formatBytes(walCheckpointBytes), " written; max ").concat(formatBytes(walCheckpointMaxBytes)), {
      title: 'Physical chrome.storage.local writes for a checkpoint switch (folding accumulated segments back into one snapshot) -- the actual byte cost of that fold, separate from the "WAL writes" card\'s checkpoint switch count. Concerning if this grows large enough to make Storage set latency spike during a switch, since a checkpoint write blocks the same serialized write queue as everything else.'
    }), buildMetricCard('Queue view writes', "".concat(viewProjectionSaved), "".concat(formatBytes(payloadQueueViewBytes), " written; avg ").concat(queueViewWriteCalls ? formatDuration(queueViewWriteLatencyMsSum / queueViewWriteCalls) : '--', ", max ").concat(formatDuration(queueViewWriteMaxLatencyMs), "; ").concat(viewProjectionFailed, " failure").concat(viewProjectionFailed === 1 ? '' : 's', " this epoch"), {
      alert: viewProjectionFailed > 0,
      // 2026-09-30: this write no longer blocks the WAL append or
      // executor-apply call that asked for it -- it's fired
      // off-critical-path and only its own completion is timed
      // here, so "avg"/"max" reflect the write's own cost, not
      // added latency on whatever triggered it.
      title: 'The durable mbCoordinatorQueueView snapshot -- what the dashboard, worker bar, popup, and CDP tools actually read -- is written by a separate, non-blocking storage.set from the WAL append it mirrors, and can fail independently under load. Any failure here means the view can show stale status (e.g. "queued") for a row the WAL already has as terminal, with only a best-effort reconcile as catch-up and no guaranteed deadline. Concerning if failures are ever nonzero, or if avg/max latency climbs -- this write is not on any other operation\'s critical path, but it still competes for the same serialized storage queue.'
    }), buildMetricCard('Read payload avg', readCalls ? formatBytes(readBytes / readCalls) : '--', "".concat(formatBytes(readBytes), " total; max ").concat(formatBytes(readMaxBytes)), {
      title: 'Average and largest single-read payload size across all storage reads this epoch. Concerning if this grows steadily over a long-running session -- it usually tracks queue/progress size, and a large max next to a much smaller average flags one unusually expensive read worth finding via Read hot path.'
    }), buildMetricCard('Read payload keys', formatBytes(readQueueBytes), "queue ".concat(formatBytes(readQueueBytes), ", view ").concat(formatBytes(readQueueViewBytes), ", progress ").concat(formatBytes(readProgressBytes)), {
      title: 'Read bytes broken down by which storage key they came from. Concerning if "queue" (the raw authoritative queue, as opposed to the cheaper "view" projection) dominates read volume long after startup -- that\'s a sign something is bypassing the queue-view/resident-cache path and reading the full queue directly.'
    }), buildMetricCard('Read hot path', topReadPath.path || '--', formatStoragePayloadPathDetail(topReadPath), {
      title: 'Which named code path (metricPath, e.g. "reconcile.load") is responsible for the most read bytes this epoch. Concerning if a path you would not expect to read often (anything outside startup/reconcile) shows up here with a high call count -- that usually means a cache that should be short-circuiting it is not.'
    }), buildMetricCard('Write payload avg', payloadCalls ? formatBytes(payloadBytes / payloadCalls) : '--', "".concat(formatBytes(payloadBytes), " total; max ").concat(formatBytes(payloadMaxBytes)), {
      title: 'Average and largest single-write payload size across all storage writes this epoch (the write-side counterpart to Read payload avg above). Concerning if this trends upward over a long session -- larger writes mean longer Storage set latency and a bigger blast radius if one gets interrupted mid-write.'
    }), buildMetricCard('Payload sources', formatBytes(payloadQueueBytes), "queue ".concat(formatBytes(payloadQueueBytes), ", view ").concat(formatBytes(payloadQueueViewBytes), ", runs ").concat(formatBytes(payloadRunsBytes), ", progress ").concat(formatBytes(payloadProgressBytes)), {
      title: 'Write bytes broken down by which storage key they went to. Not concerning by itself -- "queue" naturally dominates on a large batch -- but useful alongside Write hot path to see which code path is driving that volume.'
    }), buildMetricCard('Write hot path', topWritePath.path || '--', formatStoragePayloadPathDetail(topWritePath), {
      title: 'Which named code path is responsible for the most write bytes this epoch -- the write-side equivalent of Read hot path. Concerning if a path outside normal enqueue/reconcile/terminal-settlement activity dominates, or if its average latency (shown in the detail line) is high relative to its byte size.'
    }), buildMetricCard('Milestone batch', milestoneFlushes ? formatRatio(milestoneReceived / milestoneFlushes) : '--', "".concat(milestoneReceived, " records / ").concat(milestoneFlushes, " flushes"), {
      title: 'How many milestone records get batched into each flush (flushed at most once every COORDINATOR_JOB_MILESTONE_FLUSH_MS, 3s). Concerning only if flushes are happening far more often than every 3s with a low records-per-flush ratio -- that would mean batching isn\'t actually coalescing anything.'
    }), buildMetricCard('Progress events', "".concat(progressReceived), "pending max ".concat(progressPendingMax), {
      trend: progressPendingMaxTrend,
      title: 'The big number is a running total of profile-progress records received this epoch -- it only ever increases until the epoch resets, so it climbing on its own is normal, not a backlog. "pending max" (detail line) is the actual backlog signal: the largest number of received-but-not-yet-applied progress records seen at once. Concerning if pending max stays elevated rather than draining back toward zero -- that means progress records are arriving faster than they\'re being applied. Card colors red when pending max grows since the last refresh, green when it falls.'
    })], state.loading ? 'Loading history...' : 'No wakeup metrics yet.');
  }
  if (journal) {
    var recentEntries = _toConsumableArray(entries).sort(function (left, right) {
      return getTime(right) - getTime(left);
    }).slice(0, 30);
    setText('metricsJournalCount', "".concat(recentEntries.length, " ").concat(recentEntries.length === 1 ? 'entry' : 'entries'));
    replaceChildren(journal, recentEntries.map(function (entry) {
      var row = document.createElement('div');
      row.className = 'row row--event';
      row.append(buildTitleCell(getMetricJournalTitle(entry), getMetricJournalSubtitle(entry), {
        title: JSON.stringify(entry.details || {})
      }), buildBadge(entry.kind || 'metric'), buildTextCell(formatMetricCounterDelta(entry.counters || {}), formatMetricDetails(entry.details || {})), buildTextCell(formatDateTime(entry.at)));
      return row;
    }), state.loading ? 'Loading history...' : 'No metrics journal entries yet.');
  }
}
function buildMetricCard() {
  var label = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var value = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var detail = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '';
  var options = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
  var card = document.createElement('div');
  var cardClasses = ['metric-card'];
  if (options.alert) {
    cardClasses.push('metric-card--alert');
  } else if (options.trend === 'up') {
    cardClasses.push('metric-card--trend-up');
  } else if (options.trend === 'down') {
    cardClasses.push('metric-card--trend-down');
  }
  card.className = cardClasses.join(' ');
  // options.title carries a fuller explanation (what this measures, plus
  // a rough "this is concerning if..." threshold) than the one-line
  // detail text has room for. Falls back to detail alone when a card
  // hasn't been given one yet, same as before this option existed.
  var fullTitle = options.title || detail;
  card.title = fullTitle;
  var labelNode = document.createElement('div');
  labelNode.className = 'metric-label';
  labelNode.textContent = label;
  var valueNode = document.createElement('div');
  valueNode.className = 'metric-value';
  valueNode.textContent = value;
  var detailNode = document.createElement('div');
  detailNode.className = 'metric-detail';
  detailNode.textContent = detail;
  detailNode.title = fullTitle;
  card.append(labelNode, valueNode, detailNode);
  return card;
}
function getMetricCounter() {
  var counters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var name = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  return Number(counters[name]) || 0;
}
function sumMetricCounters() {
  var counters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var prefix = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  return Object.entries(counters || {}).filter(function (_ref13) {
    var _ref14 = _slicedToArray(_ref13, 1),
      key = _ref14[0];
    return key.startsWith(prefix);
  }).reduce(function (total, _ref15) {
    var _ref16 = _slicedToArray(_ref15, 2),
      value = _ref16[1];
    return total + (Number(value) || 0);
  }, 0);
}
function getTopStoragePayloadPath() {
  var counters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var direction = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'read';
  var normalizedDirection = direction === 'write' ? 'write' : 'read';
  var prefix = "storagePayload.".concat(normalizedDirection, ".path.");
  var suffix = '.bytes';
  var top = Object.entries(counters || {}).filter(function (_ref17) {
    var _ref18 = _slicedToArray(_ref17, 1),
      key = _ref18[0];
    return key.startsWith(prefix) && key.endsWith(suffix);
  }).map(function (_ref19) {
    var _ref20 = _slicedToArray(_ref19, 2),
      key = _ref20[0],
      value = _ref20[1];
    var path = key.slice(prefix.length, -suffix.length);
    var bytes = Number(value) || 0;
    return {
      path: path,
      bytes: bytes,
      calls: getMetricCounter(counters, "".concat(prefix).concat(path, ".calls")),
      rows: getMetricCounter(counters, "".concat(prefix).concat(path, ".rows")),
      maxBytes: getMetricCounter(counters, "".concat(prefix).concat(path, ".maxBytes")),
      latencyMs: getMetricCounter(counters, "".concat(prefix).concat(path, ".latencyMs")),
      maxLatencyMs: getMetricCounter(counters, "".concat(prefix).concat(path, ".maxLatencyMs"))
    };
  }).sort(function (left, right) {
    return right.bytes - left.bytes;
  })[0];
  return top || {
    path: '',
    bytes: 0,
    calls: 0,
    rows: 0,
    maxBytes: 0,
    latencyMs: 0,
    maxLatencyMs: 0
  };
}
function formatStoragePayloadPathDetail() {
  var pathMetrics = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if (!(pathMetrics !== null && pathMetrics !== void 0 && pathMetrics.path)) return 'no samples';
  var avgLatency = pathMetrics.calls ? pathMetrics.latencyMs / pathMetrics.calls : 0;
  return "".concat(formatBytes(pathMetrics.bytes), " / ").concat(pathMetrics.calls, " calls; max ").concat(formatBytes(pathMetrics.maxBytes), "; avg ").concat(formatDuration(avgLatency));
}
function formatRatio() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  if (!Number.isFinite(value)) return '--';
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
function formatPercent() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  if (!Number.isFinite(value)) return '--';
  return "".concat(Math.round(value * 100), "%");
}
function formatBytes() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var bytes = Number(value) || 0;
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return "".concat(Math.round(bytes), " B");
  if (bytes < 1024 * 1024) return "".concat((bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1), " KB");
  return "".concat((bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1), " MB");
}
function formatPreviousEpochSummary() {
  var _epoch$storage, _epoch$storage2, _epoch$storagePayload, _epoch$storagePayload2, _epoch$jobs;
  var epoch = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!epoch) return 'none';
  var timedOut = Number((_epoch$storage = epoch.storage) === null || _epoch$storage === void 0 ? void 0 : _epoch$storage.timedOut) || 0;
  var started = Number((_epoch$storage2 = epoch.storage) === null || _epoch$storage2 === void 0 ? void 0 : _epoch$storage2.started) || 0;
  var timeoutRate = started ? formatPercent(timedOut / started) : '0%';
  var writeBytes = Number((_epoch$storagePayload = epoch.storagePayload) === null || _epoch$storagePayload === void 0 ? void 0 : _epoch$storagePayload.writeBytes) || 0;
  var writeCalls = Number((_epoch$storagePayload2 = epoch.storagePayload) === null || _epoch$storagePayload2 === void 0 ? void 0 : _epoch$storagePayload2.writeCalls) || 0;
  var jobsTerminal = Number((_epoch$jobs = epoch.jobs) === null || _epoch$jobs === void 0 ? void 0 : _epoch$jobs.terminal) || 0;
  return "".concat(epoch.resetReason || 'epoch', ": ").concat(timeoutRate, " storage timeouts, ").concat(formatBytes(writeBytes), " / ").concat(writeCalls, " writes, ").concat(jobsTerminal, " terminal jobs");
}
function formatPhaseAverage() {
  var phase = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!(phase !== null && phase !== void 0 && phase.count)) return '--';
  return formatDuration((Number(phase.totalMs) || 0) / phase.count);
}
function getPhaseAverageMs() {
  var phase = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!(phase !== null && phase !== void 0 && phase.count)) return 0;
  return (Number(phase.totalMs) || 0) / phase.count;
}
function formatPhaseDetail() {
  var phase = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
  if (!(phase !== null && phase !== void 0 && phase.count)) return 'no samples';
  return "".concat(phase.count, " samples, max ").concat(formatDuration(Number(phase.maxMs) || 0));
}
function getMetricJournalTitle() {
  var entry = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var name = "".concat(entry.name || entry.kind || 'metric').trim();
  var result = "".concat(entry.result || '').trim();
  var reason = "".concat(entry.resultReason || entry.reason || '').trim();
  return [name, result].filter(Boolean).join(' - ') || 'Metric cycle';
}
function getMetricJournalSubtitle() {
  var entry = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var reason = "".concat(entry.reason || '').trim();
  var duration = Number(entry.durationMs) > 0 ? formatDuration(Number(entry.durationMs)) : '';
  return [reason, duration].filter(Boolean).join(' • ');
}
function formatMetricCounterDelta() {
  var counters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var entries = Object.entries(counters || {}).filter(function (_ref21) {
    var _ref22 = _slicedToArray(_ref21, 2),
      value = _ref22[1];
    return Number(value) !== 0;
  }).slice(0, 3).map(function (_ref23) {
    var _ref24 = _slicedToArray(_ref23, 2),
      key = _ref24[0],
      value = _ref24[1];
    return "".concat(key.replace(/^[^.]+\./, ''), " +").concat(value);
  });
  return entries.join(', ');
}
function formatMetricDetails() {
  var details = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var priorityKeys = ['totalMs', 'queueWaitMs', 'runMs', 'timeoutMs', 'timedOut', 'deadlineMissed', 'fallbackReturned', 'abandoned', 'timeoutPhase', 'ownStorageGetMs', 'storageGetCumulativeMs', 'ownStorageSetMs', 'storageSetCumulativeMs', 'payloadBytes', 'payloadKeys', 'storageGetCalls', 'storageSetCalls', 'durableActiveRows', 'durableQueuedRows', 'durableTerminalRows', 'activeQueuedTabs', 'queuedTabActions', 'pendingTabActions'];
  var used = new Set();
  var orderedEntries = [];
  for (var _i = 0, _priorityKeys = priorityKeys; _i < _priorityKeys.length; _i++) {
    var key = _priorityKeys[_i];
    if (Object.prototype.hasOwnProperty.call(details || {}, key)) {
      used.add(key);
      orderedEntries.push([key, details[key]]);
    }
  }
  for (var _i2 = 0, _Object$entries = Object.entries(details || {}); _i2 < _Object$entries.length; _i2++) {
    var entry = _Object$entries[_i2];
    if (!used.has(entry[0])) orderedEntries.push(entry);
  }
  return orderedEntries.slice(0, 14).map(function (_ref25) {
    var _ref26 = _slicedToArray(_ref25, 2),
      key = _ref26[0],
      value = _ref26[1];
    return "".concat(key, ": ").concat(formatMetricDetailValue(key, value));
  }).join('\n');
}
function formatMetricDetailValue() {
  var key = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var value = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  if (/Ms$/.test(key) && Number.isFinite(Number(value))) return formatDuration(Number(value));
  if (key === 'payloadBytes' && Number.isFinite(Number(value))) return formatBytes(Number(value));
  return "".concat(value);
}
function renderQueue(items) {
  var container = document.getElementById('queueList');
  if (!container) return;
  var sortedItems = _toConsumableArray(items).sort(compareCurrentWorkItems);
  replaceChildren(container, sortedItems.map(function (item) {
    var _item$source;
    var actionLabel = getQueueActionLabel(item);
    var profileHref = "".concat((item === null || item === void 0 ? void 0 : item.targetProfileHref) || '').trim();
    var itemHref = getQueueItemHref('', item);
    var sourcePageUrl = "".concat((item === null || item === void 0 || (_item$source = item.source) === null || _item$source === void 0 ? void 0 : _item$source.pageUrl) || '').trim();
    var profileLabel = profileHref ? getProfileLabelFromHref(profileHref) : '';
    var titleLabel = getQueueItemTitleLabel(item, profileLabel);
    var titleHref = normalizeExternalHref(profileHref || item.requestedUrl || itemHref);
    var sourceLabel = getSourceLabelFromUrl(sourcePageUrl);
    var row = document.createElement('div');
    row.className = 'row row--queue';
    row.append(buildTitleCell(titleLabel, "".concat(actionLabel).concat(sourceLabel ? " \u2022 ".concat(sourceLabel) : ''), {
      titleHref: titleHref,
      subtitleHref: sourcePageUrl
    }), buildQueueCancelCell(item), buildBadge(item.status || 'unknown', "".concat(item.status || '').trim() === 'failed' ? item.error || item.outcome || '' : ''), buildTextCell(item.outcome || item.error || '', getOutcomeHelp(item.outcome || item.error || '')), buildQueueTimingCell(item), buildQueueActionCell(item));
    return row;
  }), state.loading ? 'Loading history...' : 'No current work yet.');
}
function isResolutionQueueItem() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return (item === null || item === void 0 ? void 0 : item.resolveProfileFromPage) === true || "".concat((item === null || item === void 0 ? void 0 : item.resolutionMode) || '').trim() === 'author-profile' || "".concat((item === null || item === void 0 ? void 0 : item.coordinatorKey) || (item === null || item === void 0 ? void 0 : item.dedupeKey) || '').startsWith('resolve-profile:');
}
function getQueueItemTitleLabel() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var profileLabel = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  if (profileLabel) return profileLabel;
  if (isResolutionQueueItem(item)) {
    var sourceLabel = getSourceLabelFromUrl(item.requestedUrl || '');
    return sourceLabel ? "Resolve ".concat(sourceLabel, " post") : 'Resolve source post';
  }
  return item.targetProfileHref || item.requestedUrl || item.id || 'Current work item';
}
function getCoordinatorActiveDurationBaseline() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var durations = [];
  var _iterator5 = _createForOfIteratorHelper(queueItems),
    _step5;
  try {
    for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
      var item = _step5.value;
      var activeAt = Number.parseInt(item === null || item === void 0 ? void 0 : item.activeAt, 10) || 0;
      var terminalAt = Number.parseInt(item === null || item === void 0 ? void 0 : item.terminalAt, 10) || 0;
      if (activeAt > 0 && terminalAt > activeAt) durations.push(terminalAt - activeAt);
    }
  } catch (err) {
    _iterator5.e(err);
  } finally {
    _iterator5.f();
  }
  if (!durations.length) return {
    mean: 0,
    stdDev: 0,
    count: 0
  };
  var mean = durations.reduce(function (sum, value) {
    return sum + value;
  }, 0) / durations.length;
  var variance = durations.length > 1 ? durations.reduce(function (sum, value) {
    return sum + Math.pow(value - mean, 2);
  }, 0) / (durations.length - 1) : 0;
  return {
    mean: mean,
    stdDev: Math.sqrt(variance),
    count: durations.length
  };
}
function getCoordinatorOutlierRowKey() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return "".concat((item === null || item === void 0 ? void 0 : item.storageKey) || (item === null || item === void 0 ? void 0 : item.dedupeKey) || (item === null || item === void 0 ? void 0 : item.targetProfileHref) || (item === null || item === void 0 ? void 0 : item.requestedUrl) || '').trim();
}

// Checked against every row on every render pass (active or terminal), not
// just at completion, so a row that's stuck and never reaches terminal
// still gets caught -- the same activeAt/terminalAt fields buildQueueTimingCell
// already uses to show "running Xs" per row. The stddev baseline is
// recomputed fresh each pass from already-terminal rows, so a currently
// slow, still-active row can't inflate the bar it's being measured against.
function checkCoordinatorOutliers() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var baseline = getCoordinatorActiveDurationBaseline(queueItems);
  var stdDevThreshold = baseline.count >= COORDINATOR_OUTLIER_MIN_SAMPLES_FOR_STDDEV ? baseline.mean + COORDINATOR_OUTLIER_STDDEV_MULTIPLIER * baseline.stdDev : Infinity;
  var _iterator6 = _createForOfIteratorHelper(queueItems),
    _step6;
  try {
    var _loop2 = function _loop2() {
        var item = _step6.value;
        var activeAt = Number.parseInt(item === null || item === void 0 ? void 0 : item.activeAt, 10) || 0;
        if (activeAt <= 0) return 0; // continue
        var terminalAt = Number.parseInt(item === null || item === void 0 ? void 0 : item.terminalAt, 10) || 0;
        var durationMs = (terminalAt || (isActiveQueueItem(item) ? Date.now() : 0)) - activeAt;
        if (durationMs <= 0) return 0; // continue
        var exceedsAbsolute = durationMs >= COORDINATOR_OUTLIER_ABSOLUTE_THRESHOLD_MS;
        var exceedsStdDev = durationMs >= stdDevThreshold;
        if (!exceedsAbsolute && !exceedsStdDev) return 0; // continue
        var rowKey = getCoordinatorOutlierRowKey(item);
        if (!rowKey) return 0; // continue
        var attemptId = "".concat((item === null || item === void 0 ? void 0 : item.attemptId) || '').trim();
        var dismissalKey = "".concat(rowKey, "|").concat(attemptId);
        if (dismissedOutlierKeys.has(dismissalKey)) return 0; // continue
        var existing = state.outliers.find(function (entry) {
          return entry.rowKey === rowKey && entry.attemptId === attemptId;
        });
        var record = {
          rowKey: rowKey,
          targetUrl: item.targetProfileHref || item.requestedUrl || rowKey,
          runId: item.runId || '',
          attemptId: attemptId,
          attemptNumber: Number.parseInt(item.attemptNumber, 10) || 0,
          actionKind: item.actionKind || '',
          status: item.status || '',
          outcome: item.outcome || item.error || '',
          activeAt: activeAt,
          terminalAt: terminalAt,
          durationMs: durationMs,
          "final": terminalAt > 0,
          thresholdReason: exceedsAbsolute && exceedsStdDev ? 'both' : exceedsAbsolute ? 'absolute' : 'stddev',
          meanDurationMsAtCapture: Math.round(baseline.mean),
          stdDevMsAtCapture: Math.round(baseline.stdDev)
        };
        if (existing) {
          Object.assign(existing, record);
        } else {
          state.outliers.push(_objectSpread(_objectSpread({}, record), {}, {
            capturedAt: Date.now(),
            flightRecorderEntries: null
          }));
          void fetchFlightRecorderForOutlier(rowKey, attemptId);
        }
      },
      _ret;
    for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
      _ret = _loop2();
      if (_ret === 0) continue;
    }
  } catch (err) {
    _iterator6.e(err);
  } finally {
    _iterator6.f();
  }
  if (state.outliers.length > COORDINATOR_OUTLIER_MAX_ENTRIES) {
    state.outliers = state.outliers.slice(-COORDINATOR_OUTLIER_MAX_ENTRIES);
  }
}

// Flight recorder is a fixed-size ring buffer on the service worker side --
// fetched once, right when a row first crosses the outlier threshold, so
// its history is pulled out before a long batch rolls it out of the buffer.
// Not re-fetched on later passes for the same row/attempt (only the timing
// fields above get refreshed while it's still active).
function fetchFlightRecorderForOutlier() {
  return _fetchFlightRecorderForOutlier.apply(this, arguments);
}
function _fetchFlightRecorderForOutlier() {
  _fetchFlightRecorderForOutlier = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee31() {
    var rowKey,
      attemptId,
      result,
      entry,
      _entry,
      _args31 = arguments;
    return _regeneratorRuntime().wrap(function _callee31$(_context31) {
      while (1) switch (_context31.prev = _context31.next) {
        case 0:
          rowKey = _args31.length > 0 && _args31[0] !== undefined ? _args31[0] : '';
          attemptId = _args31.length > 1 && _args31[1] !== undefined ? _args31[1] : '';
          _context31.prev = 2;
          _context31.next = 5;
          return sendRuntimeMessageWithTimeout({
            action: 'get-flight-recorder',
            rowKey: rowKey,
            limit: 50
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 5:
          result = _context31.sent;
          entry = state.outliers.find(function (item) {
            return item.rowKey === rowKey && item.attemptId === attemptId;
          });
          if (entry) entry.flightRecorderEntries = Array.isArray(result === null || result === void 0 ? void 0 : result.entries) ? result.entries : [];
          _context31.next = 14;
          break;
        case 10:
          _context31.prev = 10;
          _context31.t0 = _context31["catch"](2);
          _entry = state.outliers.find(function (item) {
            return item.rowKey === rowKey && item.attemptId === attemptId;
          });
          if (_entry) _entry.flightRecorderEntries = [];
        case 14:
          renderOutliers();
        case 15:
        case "end":
          return _context31.stop();
      }
    }, _callee31, null, [[2, 10]]);
  }));
  return _fetchFlightRecorderForOutlier.apply(this, arguments);
}
function clearEventHistogram() {
  eventHistogramClearedAtMs = Date.now();
  renderEventHistogram();
}
function clearOutliers() {
  var _iterator7 = _createForOfIteratorHelper(state.outliers),
    _step7;
  try {
    for (_iterator7.s(); !(_step7 = _iterator7.n()).done;) {
      var outlier = _step7.value;
      dismissedOutlierKeys.add("".concat(outlier.rowKey, "|").concat(outlier.attemptId));
    }
  } catch (err) {
    _iterator7.e(err);
  } finally {
    _iterator7.f();
  }
  state.outliers = [];
  renderOutliers();
}
function renderOutliers() {
  var container = document.getElementById('outlierList');
  var countLabel = document.getElementById('outlierCount');
  if (countLabel) {
    countLabel.textContent = "".concat(state.outliers.length, " outlier").concat(state.outliers.length === 1 ? '' : 's');
  }
  if (!container) return;
  var sortedOutliers = _toConsumableArray(state.outliers).sort(function (left, right) {
    return right.durationMs - left.durationMs;
  });
  replaceChildren(container, sortedOutliers.map(function (outlier) {
    var profileLabel = outlier.targetUrl ? getProfileLabelFromHref(outlier.targetUrl) : outlier.rowKey;
    var row = document.createElement('div');
    row.className = 'row row--event';
    row.append(buildTitleCell(profileLabel || outlier.rowKey, outlier.runId, {
      titleHref: normalizeExternalHref(outlier.targetUrl),
      title: JSON.stringify(outlier.flightRecorderEntries || [])
    }), buildBadge(outlier["final"] ? outlier.status || 'unknown' : 'active'), buildTextCell("".concat(formatDuration(outlier.durationMs), " (").concat(outlier.thresholdReason, ")"), "mean ".concat(formatDuration(outlier.meanDurationMsAtCapture), ", stddev ").concat(formatDuration(outlier.stdDevMsAtCapture), " at capture")), buildTextCell(formatDateTime(outlier.capturedAt)));
    return row;
  }), 'No outliers this session.');
}
function buildQueueTimingCell() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var cell = document.createElement('div');
  cell.className = 'row-subtitle row-time-cell';
  var queuedAt = Number.parseInt(item.queuedAt || item.createdAt, 10) || 0;
  var activeAt = Number.parseInt(item.activeAt, 10) || 0;
  var terminalAt = Number.parseInt(item.terminalAt, 10) || 0;
  var updatedAt = Number.parseInt(item.updatedAt || item.createdAt, 10) || 0;
  var primaryAt = activeAt || queuedAt || updatedAt;
  var secondaryAt = terminalAt || updatedAt;
  var activeDurationMs = activeAt ? (terminalAt || (isActiveQueueItem(item) ? Date.now() : updatedAt || Date.now())) - activeAt : 0;
  var primary = document.createElement('div');
  primary.className = 'row-time-line';
  primary.textContent = activeAt ? "active ".concat(formatTime(activeAt)) : queuedAt ? "queued ".concat(formatTime(queuedAt)) : updatedAt ? "updated ".concat(formatTime(updatedAt)) : '';
  var secondary = document.createElement('div');
  secondary.className = 'row-time-line row-time-line--detail';
  secondary.textContent = terminalAt ? "done ".concat(formatTime(terminalAt)).concat(activeDurationMs > 0 ? " \u2022 active ".concat(formatDuration(activeDurationMs)) : '') : activeAt && activeDurationMs > 0 ? "running ".concat(formatDuration(activeDurationMs)) : secondaryAt && secondaryAt !== primaryAt ? "updated ".concat(formatTime(secondaryAt)) : '';
  cell.append(primary, secondary);
  cell.title = [queuedAt ? "queued ".concat(formatDateTime(queuedAt)) : '', activeAt ? "active ".concat(formatDateTime(activeAt)) : '', terminalAt ? "terminal ".concat(formatDateTime(terminalAt)) : '', activeDurationMs > 0 ? "".concat(terminalAt ? 'active to terminal' : 'active elapsed', " ").concat(formatDuration(activeDurationMs)) : ''].filter(Boolean).join('\n');
  return cell;
}
function buildQueueCancelCell() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var cell = document.createElement('div');
  cell.className = 'row-cancel-cell';
  if (!isPendingQueueStatus("".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim())) return cell;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'clear-button row-action-button row-cancel-button';
  button.textContent = 'Cancel';
  button.title = 'Cancel this queued Current Work item';
  button.addEventListener('click', function (event) {
    event.preventDefault();
    button.disabled = true;
    void cancelCurrentWorkItem(item);
  });
  cell.appendChild(button);
  return cell;
}
function buildQueueActionCell() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var cell = document.createElement('div');
  cell.className = 'row-action-cell';
  var itemStatus = "".concat((item === null || item === void 0 ? void 0 : item.status) || '');
  if (itemStatus !== 'failed' && itemStatus !== 'canceled') return cell;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'clear-button row-action-button';
  button.textContent = 'Requeue';
  button.title = "Reset and requeue this ".concat(itemStatus, " Current Work item");
  button.addEventListener('click', function (event) {
    event.preventDefault();
    button.disabled = true;
    void requeueFailedItem(item);
  });
  cell.appendChild(button);
  return cell;
}
function compareCurrentWorkItems() {
  var left = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var right = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var rankDiff = getCurrentWorkSortRank(left) - getCurrentWorkSortRank(right);
  if (rankDiff) return rankDiff;
  var leftHref = function leftHref() {
    return "".concat(getQueueItemHref('', left) || (left === null || left === void 0 ? void 0 : left.storageKey) || (left === null || left === void 0 ? void 0 : left.id) || '');
  };
  var rightHref = function rightHref() {
    return "".concat(getQueueItemHref('', right) || (right === null || right === void 0 ? void 0 : right.storageKey) || (right === null || right === void 0 ? void 0 : right.id) || '');
  };

  // 2026-09-16: 'queued' rows used to break ties by time descending, same
  // as every other rank -- but that puts the most-recently-added row at
  // the top and the row nearest the front of the real dispatch line at
  // the bottom, backwards from what "what's about to become active" is
  // supposed to show. The real executor's base traversal order
  // (queueRuntime.rebuildQueueOrder, before its own backoff/fairness/
  // concurrency filtering) walks queued rows by queueSequence ascending,
  // so this sorts the same way. See the matching fix in
  // swCoordinatorQueueView.js's buildCoordinatorQueueView, which this
  // client-side re-sort otherwise clobbers every render.
  if (getCurrentWorkSortRank(left) === 1) {
    return (Number.parseInt(left === null || left === void 0 ? void 0 : left.queueSequence, 10) || 0) - (Number.parseInt(right === null || right === void 0 ? void 0 : right.queueSequence, 10) || 0) || getTime(left) - getTime(right) || leftHref().localeCompare(rightHref());
  }
  return getTime(right) - getTime(left) || leftHref().localeCompare(rightHref());
}
function getCurrentWorkSortRank() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var status = "".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim();
  if (isActiveQueueItem(item)) return 0;
  if (status === 'queued') return 1;
  if (isEligibleRetryFailedQueueItem(item)) return 2;
  if (status === 'failed') return 3;
  if (!isTerminalQueueItem(item)) return 4;
  return 5;
}
function getQueueActionLabel() {
  var item = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if (isResolutionQueueItem(item)) return 'Resolve Profile';
  var actionKind = "".concat((item === null || item === void 0 ? void 0 : item.actionKind) || (item === null || item === void 0 ? void 0 : item.executorTabAction) || (item === null || item === void 0 ? void 0 : item.tabAction) || '').trim();
  if (actionKind === 'unblock-unmute') return 'Unblock Unmute';
  if (actionKind === 'mute-block' || actionKind === 'nuke') return 'Mute Block';
  return actionKind || 'Mute Block';
}
function getRunSubmitTime() {
  var runId = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var run = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var event = state.events.find(function (candidate) {
    return (candidate === null || candidate === void 0 ? void 0 : candidate.runId) && candidate.runId === runId;
  });
  return Number.parseInt((event === null || event === void 0 ? void 0 : event.at) || (run === null || run === void 0 ? void 0 : run.submittedAt) || (run === null || run === void 0 ? void 0 : run.createdAt), 10) || 0;
}
function getRunDisplay() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var submittedAt = getRunSubmitTime(run.id || run.runId || '', run);
  var submittedLabel = submittedAt ? "submitted ".concat(formatDateTime(submittedAt)) : '';
  var sourcePageUrl = getRunSourcePageUrl(run);
  var targetHrefs = getRunDisplayTargetHrefs(run);
  var singleTargetHref = targetHrefs.length === 1 ? targetHrefs[0] : '';
  var profileLabel = getProfileLabelFromHref(singleTargetHref);
  if (isFailedRetryRun(run)) {
    if (profileLabel) {
      return {
        title: profileLabel,
        subtitle: ['Retry failed target', submittedLabel].filter(Boolean).join(' • '),
        titleHref: singleTargetHref
      };
    }
    return {
      title: "".concat(targetHrefs.length || Number.parseInt(run.itemCount, 10) || 0, " failed targets"),
      subtitle: ['Retry failed targets', submittedLabel].filter(Boolean).join(' • '),
      titleHref: ''
    };
  }
  var enqueueBreakdown = formatCoordinatorEnqueueBreakdown({
    requested: run.enqueueRequested,
    queued: run.enqueueQueued,
    merged: run.enqueueMerged,
    preFilter: run.enqueuePreFilter
  });
  return {
    title: getRunSourceLabel(run),
    subtitle: [submittedLabel, enqueueBreakdown].filter(Boolean).join(' • '),
    titleHref: sourcePageUrl
  };
}
function getRunDisplayTargetHrefs() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if (Array.isArray(run.displayTargetProfileHrefs) && run.displayTargetProfileHrefs.length) {
    return run.displayTargetProfileHrefs.map(function (href) {
      return "".concat(href || '').trim();
    }).filter(Boolean);
  }
  return getRunTargetHrefs(run);
}
function isFailedRetryRun() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return "".concat((run === null || run === void 0 ? void 0 : run.sourceType) || '') === 'failed-retry' || "".concat((run === null || run === void 0 ? void 0 : run.id) || (run === null || run === void 0 ? void 0 : run.runId) || '').startsWith('retry-failed-');
}
function getRunSourceLabel() {
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var sourcePage = getRunSourcePageUrl(run);
  return getSourceLabelFromUrl(sourcePage) || "".concat(run.sourceType || 'unknown', " source");
}
function getRunSourcePageUrl() {
  var _run$source;
  var run = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var sourcePages = Array.isArray(run.sourcePages) ? run.sourcePages : [];
  return "".concat(sourcePages[0] || (run === null || run === void 0 || (_run$source = run.source) === null || _run$source === void 0 ? void 0 : _run$source.pageUrl) || '').trim();
}
function getEventSourceLabel() {
  var _event$details;
  var event = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return getSourceLabelFromUrl((event === null || event === void 0 || (_event$details = event.details) === null || _event$details === void 0 ? void 0 : _event$details.sourcePageUrl) || '') || 'Unknown source';
}
function getEventDisplay() {
  var _event$details2;
  var event = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var sourcePageUrl = "".concat((event === null || event === void 0 || (_event$details2 = event.details) === null || _event$details2 === void 0 ? void 0 : _event$details2.sourcePageUrl) || '').trim();
  var sourceLabel = getEventSourceLabel(event);
  var targetHref = getEventTargetProfileHref(event);
  var profileLabel = getProfileLabelFromHref(targetHref);
  if ("".concat((event === null || event === void 0 ? void 0 : event.type) || '') === 'retry') {
    return {
      subtitle: profileLabel || (targetHref ? targetHref : sourceLabel),
      subtitleHref: targetHref || sourcePageUrl
    };
  }
  return {
    subtitle: "".concat(sourceLabel).concat(event.runId ? " \u2022 ".concat(event.runId) : ''),
    subtitleHref: sourcePageUrl
  };
}
function getEventTargetProfileHref() {
  var _state$runs;
  var event = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var details = event.details || {};
  var detailHrefs = Array.isArray(details.targetProfileHrefs) ? details.targetProfileHrefs.map(function (href) {
    return "".concat(href || '').trim();
  }).filter(Boolean) : [];
  if (detailHrefs.length === 1) return detailHrefs[0];
  if (details.targetProfileHref || details.profileHref) return "".concat(details.targetProfileHref || details.profileHref || '').trim();
  var run = event.runId ? ((_state$runs = state.runs) === null || _state$runs === void 0 ? void 0 : _state$runs[event.runId]) || null : null;
  var runHrefs = getRunTargetHrefs(run || {});
  if (runHrefs.length === 1) return runHrefs[0];
  return '';
}
function getSourceLabelFromUrl() {
  var url = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  if (!url) return '';
  for (var _i3 = 0, _Object$values = Object.values(state.spaceRegistry || {}); _i3 < _Object$values.length; _i3++) {
    var record = _Object$values[_i3];
    if (!record || _typeof(record) !== 'object') continue;
    if (record.url && sameOriginUrl(record.url, url)) return record.name || record.slug || record.url;
  }
  try {
    var host = new URL(url).hostname.replace(/\.quora\.com$/i, '');
    if (!host || host === 'www') return 'Quora';
    return host.split(/[-_]/).filter(Boolean).map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  } catch (_unused5) {
    return '';
  }
}
function getProfileLabelFromHref() {
  var href = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var slug = getProfileSlugFromHref(href);
  if (!slug) return '';
  return slug.split(/[-_\s]+/).filter(Boolean).map(formatProfileSlugPart).join(' ');
}
function getProfileSlugFromHref() {
  var href = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var value = "".concat(href || '').trim();
  if (!value) return '';
  try {
    var url = new URL(value);
    var segments = url.pathname.split('/').map(function (part) {
      return decodeURIComponent(part.trim());
    }).filter(Boolean);
    if (!segments.length) return '';
    if (segments[0].toLowerCase() === 'profile') return segments[1] || '';
    return segments[0];
  } catch (_unused6) {
    return '';
  }
}
function formatProfileSlugPart() {
  var part = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  if (/^[A-Z0-9]+$/.test(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}
function sameOriginUrl() {
  var left = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var right = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (_unused7) {
    return false;
  }
}
function formatEventDetails() {
  var event = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var details = event.details || {};
  var queued = Number.parseInt(details.queued, 10);
  var merged = Number.parseInt(details.merged, 10);
  var parts = [];
  if (Number.isFinite(queued)) parts.push("".concat(queued, " new"));
  if (Number.isFinite(merged)) parts.push("".concat(merged, " merged"));
  return parts.join(', ');
}
function replaceChildren(container, children, emptyText) {
  container.replaceChildren();
  if (children.length) {
    container.append.apply(container, _toConsumableArray(children));
    return;
  }
  var empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = emptyText;
  container.append(empty);
}
function buildTitleCell(title, subtitle) {
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var cell = document.createElement('div');
  var titleNode = buildMaybeLink(options.titleHref, 'row-title');
  var subtitleNode = buildMaybeLink(options.subtitleHref, 'row-subtitle');
  titleNode.className = 'row-title';
  subtitleNode.className = 'row-subtitle';
  titleNode.textContent = title || '';
  subtitleNode.textContent = subtitle || '';
  if (options.title) cell.title = options.title;
  cell.append(titleNode, subtitleNode);
  return cell;
}
function buildMaybeLink(href, className) {
  var normalizedHref = normalizeExternalHref(href);
  var node = document.createElement(normalizedHref ? 'a' : 'div');
  node.className = className;
  if (normalizedHref) {
    node.href = normalizedHref;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
  return node;
}
function normalizeExternalHref() {
  var href = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var value = "".concat(href || '').trim();
  if (!value) return '';
  try {
    var url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch (_unused8) {}
  return '';
}
function buildBadge(value) {
  var detail = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var badge = document.createElement('span');
  var normalized = "".concat(value || 'unknown').toLowerCase();
  badge.className = "badge badge--".concat(normalized.replace(/[^a-z0-9_-]/g, '-'));
  badge.textContent = normalized;
  var trimmedDetail = "".concat(detail || '').trim();
  badge.title = trimmedDetail ? "".concat(getStatusHelp(normalized), " ").concat(trimmedDetail) : getStatusHelp(normalized);
  return badge;
}
function buildTextCell(value) {
  var title = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  var cell = document.createElement('div');
  cell.className = 'row-subtitle';
  cell.textContent = "".concat(value || '');
  if (title) cell.title = title;
  return cell;
}
function getStatusHelp() {
  var status = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var normalized = "".concat(status || '').trim();
  var descriptions = {
    queued: 'Ready to run: waiting for a worker slot.',
    opening: 'Opening: a worker tab is being created or navigated.',
    active: 'Active: a worker tab is claimed and preparing the profile action.',
    acting: 'Acting: a mute, block, unblock, or unmute action is in progress.',
    settling: 'Settling: terminal action finished and cleanup or source-page settlement is pending.',
    succeeded: 'Succeeded: target is blocked, unblocked, or already in the desired state.',
    failed: 'Failed: work ended without success. Outcome/error explains retryability.',
    skipped: 'Skipped: no destructive work was possible or needed.',
    canceled: 'Canceled: work was stopped by an operator action.',
    running: 'Running: the run has queued or in-progress items.',
    empty: 'Empty: every target in the run has reached a terminal state, or the run has no items.',
    retry: 'Retry: failed-row retry action.',
    enqueued: 'Enqueued: new queue work was submitted.',
    paused: 'Paused: pending work was stopped.'
  };
  return descriptions[normalized] || "".concat(normalized || 'unknown', " status");
}
function getOutcomeHelp() {
  var outcome = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
  var normalized = "".concat(outcome || '').trim();
  var descriptions = {
    blocked: 'Blocked: the profile was blocked during this run.',
    'already-blocked': 'Already blocked: the profile was already in the desired blocked state.',
    unblocked: 'Unblocked: the reverse action removed the block.',
    'already-unblocked': 'Already unblocked: the profile was already in the desired unblocked state.',
    timeout: 'Timeout: retryable failure from a missing, stale, or over-deadline worker.',
    'action-error': 'Action error: retryable failure while finding or applying the profile action.',
    'security-verification': 'Security verification: non-retryable Quora challenge or verification state.',
    'profile-unavailable': 'Profile unavailable: the target could not be acted on.',
    'unresolved-target': 'Unresolved target: source evidence did not identify one profile target.',
    paused: 'Paused: canceled by operator pause.'
  };
  return descriptions[normalized] || '';
}
function getTime(record) {
  return Number.parseInt((record === null || record === void 0 ? void 0 : record.updatedAt) || (record === null || record === void 0 ? void 0 : record.createdAt) || (record === null || record === void 0 ? void 0 : record.at), 10) || 0;
}
function formatTime(value) {
  var timestamp = Number.parseInt(value, 10);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
function formatDateTime(value) {
  var timestamp = Number.parseInt(value, 10);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
function formatDuration(valueMs) {
  var totalSeconds = Math.max(0, Math.round((Number.parseInt(valueMs, 10) || 0) / 1000));
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor(totalSeconds % 3600 / 60);
  var seconds = totalSeconds % 60;
  if (hours) return "".concat(hours, "h ").concat(String(minutes).padStart(2, '0'), "m");
  if (minutes) return "".concat(minutes, "m ").concat(String(seconds).padStart(2, '0'), "s");
  return "".concat(seconds, "s");
}
function renderScanCostHistogram() {
  var container = document.getElementById('scanCostHistogram');
  if (!container) return;
  var metricsDocument = state.metrics || {};
  var counters = (metricsDocument.currentEpoch || metricsDocument).counters || {};

  // Find all scan.<location>.items counters and extract location names
  var scanData = [];
  var locationSet = new Set();
  Object.keys(counters).forEach(function (key) {
    var match = key.match(/^scan\.([^.]+)\.items$/);
    if (match) {
      var _location = match[1];
      locationSet.add(_location);
    }
  });

  // Build data for each location
  locationSet.forEach(function (location) {
    var itemsCount = getMetricCounter(counters, "scan.".concat(location, ".items"));
    var callsCount = getMetricCounter(counters, "scan.".concat(location, ".calls"));
    if (itemsCount > 0 || callsCount > 0) {
      scanData.push({
        label: location,
        value: itemsCount,
        detail: "".concat(itemsCount, " items / ").concat(callsCount, " calls")
      });
    }
  });
  scanData.sort(function (a, b) {
    return b.value - a.value;
  });
  renderHorizontalHistogram(container, scanData);
}
function renderAuthorityLoadHistogram() {
  var container = document.getElementById('authorityLoadHistogram');
  if (!container) return;
  var metricsDocument = state.metrics || {};
  var counters = (metricsDocument.currentEpoch || metricsDocument).counters || {};

  // authorityLoad.<verb>.<from>.calls -- calls of interest to the
  // coordinator-authority-state accessors, not flight-recorder events.
  var authorityLoadData = [];
  Object.keys(counters).forEach(function (key) {
    var match = key.match(/^authorityLoad\.([^.]+)\.(.+)\.calls$/);
    if (!match) return;
    var _match = _slicedToArray(match, 3),
      verb = _match[1],
      from = _match[2];
    var callsCount = getMetricCounter(counters, key);
    if (callsCount <= 0) return;
    authorityLoadData.push({
      label: "".concat(verb, ": ").concat(from),
      value: callsCount,
      detail: "".concat(callsCount, " call").concat(callsCount === 1 ? '' : 's')
    });
  });
  authorityLoadData.sort(function (a, b) {
    return b.value - a.value;
  });
  renderHorizontalHistogram(container, authorityLoadData);
}
function renderEventHistogram() {
  var container = document.getElementById('eventHistogram');
  if (!container) return;

  // Send message to get flight recorder entries
  sendRuntimeMessageWithTimeout({
    action: 'get-flight-recorder',
    limit: 2000
  }, {
    entries: []
  }, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).then(function (response) {
    var entries = response && Array.isArray(response.entries) ? response.entries : [];

    // Tally occurrences by kind:reason
    var eventCounts = {};
    entries.forEach(function (entry) {
      if (!entry || _typeof(entry) !== 'object') return;
      if ((Number.parseInt(entry.at, 10) || 0) < eventHistogramClearedAtMs) return;
      var label = "".concat(entry.kind || 'unknown', ":").concat(entry.reason || '');
      eventCounts[label] = (eventCounts[label] || 0) + 1;
    });

    // Convert to array and sort by count descending
    var eventData = Object.entries(eventCounts).map(function (_ref27) {
      var _ref28 = _slicedToArray(_ref27, 2),
        label = _ref28[0],
        count = _ref28[1];
      return {
        label: label,
        value: count,
        detail: "".concat(count)
      };
    }).sort(function (a, b) {
      return b.value - a.value;
    });
    renderHorizontalHistogram(container, eventData);
  })["catch"](function () {
    // If message fails, render empty state
    renderHorizontalHistogram(container, []);
  });
}

// 2026-10-06: average time spent in each phase of a mute-block action's
// notice-select-open-load-inspect-action-detect-close cycle, sourced from
// profileAction.phase.<key>.totalMs/sampleCount (swCoordinatorProgressReducer.js's
// recordCoordinatorProfileActionPhaseDurations, computed from each terminal
// row's own milestone timestamps). 'Notice/select' is covered separately by
// secs/handoff -- this starts at 'open' (row goes active -> tab created).
var COORDINATOR_PROFILE_ACTION_PHASE_LABELS = [['open', 'Open (active → tab created)'], ['navigate', 'Navigate (tab created → navigation started)'], ['load', 'Load (navigation → content script opened)'], ['claim', 'Claim (content opened → action claimed)'], ['inspect', 'Inspect (claimed → profile ready)'], ['action', 'Action (ready → mute/block attempted)'], ['detect', 'Detect (attempted → terminal)'], ['close', 'Close (terminal → tab closed)']];
function formatPhaseTimingDurationMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return "".concat(Math.round(value), "ms");
  return "".concat((value / 1000).toFixed(value < 10000 ? 1 : 0), "s");
}
function renderPhaseTimingHistogram() {
  var container = document.getElementById('phaseTimingHistogram');
  if (!container) return;
  var metricsDocument = state.metrics || {};
  var metrics = metricsDocument.currentEpoch || metricsDocument;
  var counters = metrics.counters || {};
  var data = COORDINATOR_PROFILE_ACTION_PHASE_LABELS.map(function (_ref29) {
    var _ref30 = _slicedToArray(_ref29, 2),
      key = _ref30[0],
      label = _ref30[1];
    var sampleCount = getMetricCounter(counters, "profileAction.phase.".concat(key, ".sampleCount"));
    var totalMs = getMetricCounter(counters, "profileAction.phase.".concat(key, ".totalMs"));
    var maxMs = getMetricCounter(counters, "profileAction.phase.".concat(key, ".maxMs"));
    var avgMs = sampleCount ? totalMs / sampleCount : 0;
    return {
      label: label,
      value: avgMs,
      detail: sampleCount ? "avg ".concat(formatPhaseTimingDurationMs(avgMs), " (n=").concat(sampleCount, ", max ").concat(formatPhaseTimingDurationMs(maxMs), ")") : 'no samples yet'
    };
  }).filter(function (row) {
    return row.value > 0;
  });
  renderHorizontalHistogram(container, data);
}
function renderHorizontalHistogram(container) {
  var data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];
  if (!container) return;
  container.replaceChildren();
  if (!data || data.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No data';
    container.append(empty);
    return;
  }

  // Find max value for scaling
  var maxValue = Math.max.apply(Math, _toConsumableArray(data.map(function (item) {
    return item.value;
  })).concat([1]));
  var barMaxWidth = 200; // pixels

  // Create rows for each data item (already sorted descending)
  data.forEach(function (item) {
    var row = document.createElement('div');
    row.className = 'histogram-row';

    // Label
    var label = document.createElement('div');
    label.className = 'histogram-label';
    label.textContent = item.label;
    label.title = item.label;

    // Bar container
    var barContainer = document.createElement('div');
    barContainer.className = 'histogram-bar-container';

    // Bar
    var bar = document.createElement('div');
    bar.className = 'histogram-bar';
    var barWidth = item.value / maxValue * barMaxWidth;
    bar.style.width = "".concat(barWidth, "px");
    bar.title = item.detail;

    // Detail label
    var detail = document.createElement('div');
    detail.className = 'histogram-bar-label';
    detail.textContent = item.detail;
    detail.title = item.detail;
    barContainer.append(bar, detail);
    row.append(label, barContainer);
    container.append(row);
  });
}
})();

/******/ })()
;