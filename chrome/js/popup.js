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
  coordinatorAutoStartOnBrowserStart: false,
  nukedPostRetentionDays: 30,
  maxRememberedNukedPosts: 10000
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

/***/ "./shared/js/spaceRegistry.js":
/*!************************************!*\
  !*** ./shared/js/spaceRegistry.js ***!
  \************************************/
/***/ ((module) => {

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var SPACE_REGISTRY_KEY = 'mbSpaceRegistry';
var SPACE_SORT_KEY = 'mbSpaceSortBy';
var SPACE_SORT_NAME = 'name';
var SPACE_SORT_CATEGORY = 'category';
var SPACE_CATEGORY_ASSET = 'asset';
var SPACE_CATEGORY_NEUTRAL = 'neutral';
var SPACE_CATEGORY_TARGET = 'target';
var SPACE_CATEGORIES = [SPACE_CATEGORY_ASSET, SPACE_CATEGORY_NEUTRAL, SPACE_CATEGORY_TARGET];
var SPACE_CATEGORY_ORDER = _defineProperty(_defineProperty(_defineProperty({}, SPACE_CATEGORY_ASSET, 0), SPACE_CATEGORY_NEUTRAL, 1), SPACE_CATEGORY_TARGET, 2);
function normalizeSpaceCategory(category) {
  return SPACE_CATEGORIES.includes(category) ? category : '';
}
function getSpaceCategoryShortLabel(category) {
  if (category === SPACE_CATEGORY_ASSET) return 'Asset';
  if (category === SPACE_CATEGORY_NEUTRAL) return 'Neutral';
  if (category === SPACE_CATEGORY_TARGET) return 'Target';
  return 'Unknown';
}
function getSpaceCategoryLongLabel(category) {
  if (category === SPACE_CATEGORY_ASSET) return 'Asset';
  if (category === SPACE_CATEGORY_NEUTRAL) return 'Neutral';
  if (category === SPACE_CATEGORY_TARGET) return 'Target';
  return 'Unknown';
}
function normalizeSpaceUrl(url) {
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    parsed.search = '';
    parsed.hash = '';
    if (parsed.hostname !== 'www.quora.com' && parsed.hostname.endsWith('.quora.com')) {
      return "".concat(parsed.protocol, "//").concat(parsed.hostname);
    }
    var pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '/';
    if (parsed.hostname !== 'www.quora.com' && pathname === '/') {
      return "".concat(parsed.protocol, "//").concat(parsed.hostname);
    }
    return "".concat(parsed.protocol, "//").concat(parsed.hostname).concat(pathname);
  } catch (_unused) {
    return '';
  }
}
function getDocumentCanonicalUrl() {
  var _doc$querySelector, _doc$querySelector2, _doc$location;
  var doc = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : document;
  var ogUrl = (_doc$querySelector = doc.querySelector('meta[property="og:url"]')) === null || _doc$querySelector === void 0 || (_doc$querySelector = _doc$querySelector.content) === null || _doc$querySelector === void 0 ? void 0 : _doc$querySelector.trim();
  if (ogUrl) return ogUrl;
  var canonical = (_doc$querySelector2 = doc.querySelector('link[rel="canonical"]')) === null || _doc$querySelector2 === void 0 || (_doc$querySelector2 = _doc$querySelector2.href) === null || _doc$querySelector2 === void 0 ? void 0 : _doc$querySelector2.trim();
  if (canonical) return canonical;
  return ((_doc$location = doc.location) === null || _doc$location === void 0 ? void 0 : _doc$location.href) || '';
}
function getSpaceName() {
  var _querySelector, _ref, _doc$querySelector3;
  var doc = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : document;
  var header = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
  var heading = (_querySelector = (_ref = header || doc).querySelector) === null || _querySelector === void 0 ? void 0 : _querySelector.call(_ref, 'h1, [role="heading"]');
  var headingText = normalizeLabel((heading === null || heading === void 0 ? void 0 : heading.textContent) || '');
  if (headingText) return headingText;
  var ogTitle = normalizeLabel(((_doc$querySelector3 = doc.querySelector('meta[property="og:title"]')) === null || _doc$querySelector3 === void 0 ? void 0 : _doc$querySelector3.content) || '');
  if (ogTitle) return ogTitle.replace(/\s+[|:-]\s+Quora.*$/i, '');
  return normalizeLabel(doc.title || '').replace(/\s+[|:-]\s+Quora.*$/i, '');
}
function extractSpaceSlug(url) {
  try {
    var parsed = new URL(url);
    if (parsed.hostname !== 'www.quora.com') {
      return parsed.hostname.replace(/\.quora\.com$/i, '');
    }
    var parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname;
  } catch (_unused2) {
    return '';
  }
}
function buildSpaceRecord(space, category) {
  var existingRecord = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
  var nextCategory = normalizeSpaceCategory(category);
  if (!nextCategory) return null;
  var key = "".concat((space === null || space === void 0 ? void 0 : space.key) || (existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.key) || '').trim();
  if (!key) return null;
  var url = normalizeSpaceUrl((space === null || space === void 0 ? void 0 : space.url) || (existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.url) || '');
  if (!url) return null;
  return {
    key: key,
    url: url,
    slug: "".concat((space === null || space === void 0 ? void 0 : space.slug) || (existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.slug) || extractSpaceSlug(url)).trim(),
    name: normalizeLabel((space === null || space === void 0 ? void 0 : space.name) || (existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.name) || extractSpaceSlug(url) || url),
    category: nextCategory,
    updatedAt: Date.now()
  };
}
function sortSpaceRecords(records) {
  var sortBy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : SPACE_SORT_NAME;
  var list = Array.isArray(records) ? records.slice() : [];
  list.sort(function (left, right) {
    if (sortBy === SPACE_SORT_CATEGORY) {
      var _SPACE_CATEGORY_ORDER2, _SPACE_CATEGORY_ORDER3;
      var categoryDelta = ((_SPACE_CATEGORY_ORDER2 = SPACE_CATEGORY_ORDER[left.category]) !== null && _SPACE_CATEGORY_ORDER2 !== void 0 ? _SPACE_CATEGORY_ORDER2 : 99) - ((_SPACE_CATEGORY_ORDER3 = SPACE_CATEGORY_ORDER[right.category]) !== null && _SPACE_CATEGORY_ORDER3 !== void 0 ? _SPACE_CATEGORY_ORDER3 : 99);
      if (categoryDelta) return categoryDelta;
    }
    var nameDelta = (left.name || '').localeCompare(right.name || '', undefined, {
      sensitivity: 'base'
    });
    if (nameDelta) return nameDelta;
    return (left.slug || '').localeCompare(right.slug || '', undefined, {
      sensitivity: 'base'
    });
  });
  return list;
}
function normalizeLabel(value) {
  return "".concat(value || '').replace(/\s+/g, ' ').trim();
}
module.exports = {
  SPACE_CATEGORY_ASSET: SPACE_CATEGORY_ASSET,
  SPACE_CATEGORY_NEUTRAL: SPACE_CATEGORY_NEUTRAL,
  SPACE_CATEGORY_ORDER: SPACE_CATEGORY_ORDER,
  SPACE_CATEGORY_TARGET: SPACE_CATEGORY_TARGET,
  SPACE_CATEGORIES: SPACE_CATEGORIES,
  SPACE_REGISTRY_KEY: SPACE_REGISTRY_KEY,
  SPACE_SORT_CATEGORY: SPACE_SORT_CATEGORY,
  SPACE_SORT_KEY: SPACE_SORT_KEY,
  SPACE_SORT_NAME: SPACE_SORT_NAME,
  buildSpaceRecord: buildSpaceRecord,
  extractSpaceSlug: extractSpaceSlug,
  getDocumentCanonicalUrl: getDocumentCanonicalUrl,
  getSpaceCategoryLongLabel: getSpaceCategoryLongLabel,
  getSpaceCategoryShortLabel: getSpaceCategoryShortLabel,
  getSpaceName: getSpaceName,
  normalizeSpaceCategory: normalizeSpaceCategory,
  normalizeSpaceUrl: normalizeSpaceUrl,
  sortSpaceRecords: sortSpaceRecords
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
/*!****************************!*\
  !*** ./shared/js/popup.js ***!
  \****************************/
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
var browser = __webpack_require__(/*! webextension-polyfill */ "./node_modules/webextension-polyfill/dist/browser-polyfill.js");
var defaults = __webpack_require__(/*! ./defaults */ "./shared/js/defaults.js");
var _require = __webpack_require__(/*! ./nukedPosts */ "./shared/js/nukedPosts.js"),
  MAX_REMEMBERED_NUKED_POSTS_KEY = _require.MAX_REMEMBERED_NUKED_POSTS_KEY,
  NUKED_POST_RETENTION_DAYS_KEY = _require.NUKED_POST_RETENTION_DAYS_KEY,
  SPACE_NUKED_POSTS_KEY = _require.SPACE_NUKED_POSTS_KEY,
  getPrunedNukedPosts = _require.getPrunedNukedPosts,
  haveSameNukedPostKeys = _require.haveSameNukedPostKeys,
  normalizeMaxRememberedNukedPosts = _require.normalizeMaxRememberedNukedPosts,
  normalizeRetentionDays = _require.normalizeRetentionDays;
var _require2 = __webpack_require__(/*! ./spaceRegistry */ "./shared/js/spaceRegistry.js"),
  SPACE_CATEGORIES = _require2.SPACE_CATEGORIES,
  SPACE_REGISTRY_KEY = _require2.SPACE_REGISTRY_KEY,
  SPACE_SORT_CATEGORY = _require2.SPACE_SORT_CATEGORY,
  SPACE_SORT_KEY = _require2.SPACE_SORT_KEY,
  SPACE_SORT_NAME = _require2.SPACE_SORT_NAME,
  buildSpaceRecord = _require2.buildSpaceRecord,
  getSpaceCategoryShortLabel = _require2.getSpaceCategoryShortLabel,
  sortSpaceRecords = _require2.sortSpaceRecords;
var popupState = {
  sortBy: SPACE_SORT_NAME,
  spaceRegistry: {},
  nukedPosts: {},
  nukedPostRetentionDays: defaults[NUKED_POST_RETENTION_DAYS_KEY],
  maxRememberedNukedPosts: defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]
};
addEventListener('load', init);
function init() {
  return _init.apply(this, arguments);
}
function _init() {
  _init = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
    var manifest, settings, form, status, spaceSortBy, spaceList, clearNukedPosts, openCoordinator, nukedPostCount, fopDelay, flipToAnswers, fopFlipDelay, coordinatorAutoStartOnBrowserStart, profilesPerBatch, nukedPostRetentionDays, maxRememberedNukedPosts;
    return _regeneratorRuntime().wrap(function _callee6$(_context6) {
      while (1) switch (_context6.prev = _context6.next) {
        case 0:
          manifest = browser.runtime.getManifest();
          _context6.next = 3;
          return browser.storage.local.get(_objectSpread(_objectSpread({}, defaults), {}, _defineProperty(_defineProperty(_defineProperty({}, SPACE_REGISTRY_KEY, {}), SPACE_SORT_KEY, SPACE_SORT_NAME), SPACE_NUKED_POSTS_KEY, {})));
        case 3:
          settings = _context6.sent;
          document.getElementById('appName').textContent = manifest.name;
          document.getElementById('appVersion').textContent = "v".concat(manifest.version);
          document.getElementById('closePopup').addEventListener('click', function () {
            return window.close();
          });
          form = document.getElementById('settingsForm');
          status = document.getElementById('status');
          spaceSortBy = document.getElementById('spaceSortBy');
          spaceList = document.getElementById('spaceList');
          clearNukedPosts = document.getElementById('clearNukedPosts');
          openCoordinator = document.getElementById('openCoordinator');
          nukedPostCount = document.getElementById('nukedPostCount');
          fopDelay = document.getElementById('fopDelay');
          flipToAnswers = document.getElementById('flipToAnswers');
          fopFlipDelay = document.getElementById('fopFlipDelay');
          coordinatorAutoStartOnBrowserStart = document.getElementById('coordinatorAutoStartOnBrowserStart');
          profilesPerBatch = document.getElementById('profilesPerBatch');
          nukedPostRetentionDays = document.getElementById('nukedPostRetentionDays');
          maxRememberedNukedPosts = document.getElementById('maxRememberedNukedPosts');
          fopDelay.value = settings.fopDelay;
          flipToAnswers.checked = settings.flipToAnswers;
          fopFlipDelay.value = settings.fopFlipDelay;
          coordinatorAutoStartOnBrowserStart.checked = settings.coordinatorAutoStartOnBrowserStart === true;
          profilesPerBatch.value = settings.profilesPerBatch;
          popupState.nukedPostRetentionDays = normalizeRetentionDays(settings[NUKED_POST_RETENTION_DAYS_KEY], defaults[NUKED_POST_RETENTION_DAYS_KEY]);
          popupState.maxRememberedNukedPosts = normalizeMaxRememberedNukedPosts(settings[MAX_REMEMBERED_NUKED_POSTS_KEY], defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]);
          nukedPostRetentionDays.value = popupState.nukedPostRetentionDays;
          maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts;
          popupState.spaceRegistry = settings[SPACE_REGISTRY_KEY] || {};
          popupState.nukedPosts = getPrunedNukedPosts(settings[SPACE_NUKED_POSTS_KEY] || {}, {
            retentionDays: popupState.nukedPostRetentionDays,
            maxEntries: popupState.maxRememberedNukedPosts
          });
          popupState.sortBy = settings[SPACE_SORT_KEY] === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME;
          spaceSortBy.value = popupState.sortBy;
          renderNukedPostCount(nukedPostCount);
          if (haveSameNukedPostKeys(settings[SPACE_NUKED_POSTS_KEY] || {}, popupState.nukedPosts)) {
            _context6.next = 38;
            break;
          }
          _context6.next = 38;
          return browser.storage.local.set(_defineProperty({}, SPACE_NUKED_POSTS_KEY, popupState.nukedPosts));
        case 38:
          form.addEventListener('submit', /*#__PURE__*/function () {
            var _ref = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee(event) {
              var nextSettings;
              return _regeneratorRuntime().wrap(function _callee$(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    event.preventDefault();
                    nextSettings = _defineProperty(_defineProperty({
                      fopDelay: fopDelay.valueAsNumber,
                      flipToAnswers: flipToAnswers.checked,
                      fopFlipDelay: fopFlipDelay.valueAsNumber,
                      coordinatorAutoStartOnBrowserStart: coordinatorAutoStartOnBrowserStart.checked,
                      profilesPerBatch: profilesPerBatch.valueAsNumber
                    }, NUKED_POST_RETENTION_DAYS_KEY, normalizeRetentionDays(nukedPostRetentionDays.valueAsNumber, defaults[NUKED_POST_RETENTION_DAYS_KEY])), MAX_REMEMBERED_NUKED_POSTS_KEY, normalizeMaxRememberedNukedPosts(maxRememberedNukedPosts.valueAsNumber, defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]));
                    popupState.nukedPostRetentionDays = nextSettings[NUKED_POST_RETENTION_DAYS_KEY];
                    popupState.maxRememberedNukedPosts = nextSettings[MAX_REMEMBERED_NUKED_POSTS_KEY];
                    popupState.nukedPosts = getPrunedNukedPosts(popupState.nukedPosts, {
                      retentionDays: popupState.nukedPostRetentionDays,
                      maxEntries: popupState.maxRememberedNukedPosts
                    });
                    nukedPostRetentionDays.value = popupState.nukedPostRetentionDays;
                    maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts;
                    renderNukedPostCount(nukedPostCount);
                    _context.next = 10;
                    return browser.storage.local.set(_objectSpread(_objectSpread({}, nextSettings), {}, _defineProperty({}, SPACE_NUKED_POSTS_KEY, popupState.nukedPosts)));
                  case 10:
                    showStatus(status, 'Settings saved.');
                  case 11:
                  case "end":
                    return _context.stop();
                }
              }, _callee);
            }));
            return function (_x4) {
              return _ref.apply(this, arguments);
            };
          }());
          form.addEventListener('reset', /*#__PURE__*/_asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
            return _regeneratorRuntime().wrap(function _callee2$(_context2) {
              while (1) switch (_context2.prev = _context2.next) {
                case 0:
                  _context2.next = 2;
                  return browser.storage.local.set(defaults);
                case 2:
                  fopDelay.value = defaults.fopDelay;
                  flipToAnswers.checked = defaults.flipToAnswers;
                  fopFlipDelay.value = defaults.fopFlipDelay;
                  coordinatorAutoStartOnBrowserStart.checked = defaults.coordinatorAutoStartOnBrowserStart === true;
                  profilesPerBatch.value = defaults.profilesPerBatch;
                  popupState.nukedPostRetentionDays = defaults[NUKED_POST_RETENTION_DAYS_KEY];
                  popupState.maxRememberedNukedPosts = defaults[MAX_REMEMBERED_NUKED_POSTS_KEY];
                  nukedPostRetentionDays.value = popupState.nukedPostRetentionDays;
                  maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts;
                  popupState.nukedPosts = getPrunedNukedPosts(popupState.nukedPosts, {
                    retentionDays: popupState.nukedPostRetentionDays,
                    maxEntries: popupState.maxRememberedNukedPosts
                  });
                  renderNukedPostCount(nukedPostCount);
                  _context2.next = 15;
                  return browser.storage.local.set(_defineProperty({}, SPACE_NUKED_POSTS_KEY, popupState.nukedPosts));
                case 15:
                  showStatus(status, 'Settings reset.');
                case 16:
                case "end":
                  return _context2.stop();
              }
            }, _callee2);
          })));
          spaceSortBy.addEventListener('change', /*#__PURE__*/_asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee3() {
            return _regeneratorRuntime().wrap(function _callee3$(_context3) {
              while (1) switch (_context3.prev = _context3.next) {
                case 0:
                  popupState.sortBy = spaceSortBy.value === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME;
                  renderSpaceList(spaceList);
                  _context3.next = 4;
                  return browser.storage.local.set(_defineProperty({}, SPACE_SORT_KEY, popupState.sortBy));
                case 4:
                case "end":
                  return _context3.stop();
              }
            }, _callee3);
          })));
          spaceList.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-space-key][data-category]');
            if (!button) return;
            event.preventDefault();
            void updateSpaceCategory(button.dataset.spaceKey, button.dataset.category, spaceList);
          });
          clearNukedPosts.addEventListener('click', /*#__PURE__*/_asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee4() {
            var count;
            return _regeneratorRuntime().wrap(function _callee4$(_context4) {
              while (1) switch (_context4.prev = _context4.next) {
                case 0:
                  count = Object.keys(popupState.nukedPosts || {}).length;
                  if (count) {
                    _context4.next = 4;
                    break;
                  }
                  showStatus(status, 'Nothing to clear.');
                  return _context4.abrupt("return");
                case 4:
                  if (window.confirm("Clear Recent History for ".concat(count, " ").concat(count === 1 ? 'entry' : 'entries', "?"))) {
                    _context4.next = 6;
                    break;
                  }
                  return _context4.abrupt("return");
                case 6:
                  popupState.nukedPosts = {};
                  renderNukedPostCount(nukedPostCount);
                  _context4.next = 10;
                  return browser.storage.local.set(_defineProperty({}, SPACE_NUKED_POSTS_KEY, {}));
                case 10:
                  showStatus(status, 'Recent History cleared.');
                case 11:
                case "end":
                  return _context4.stop();
              }
            }, _callee4);
          })));
          openCoordinator === null || openCoordinator === void 0 || openCoordinator.addEventListener('click', /*#__PURE__*/_asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
            var result;
            return _regeneratorRuntime().wrap(function _callee5$(_context5) {
              while (1) switch (_context5.prev = _context5.next) {
                case 0:
                  _context5.next = 2;
                  return browser.runtime.sendMessage({
                    action: 'open-coordinator',
                    active: true
                  })["catch"](function (error) {
                    return {
                      error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
                    };
                  });
                case 2:
                  result = _context5.sent;
                  showStatus(status, result !== null && result !== void 0 && result.error ? 'Dashboard open failed.' : 'Dashboard opened.');
                case 4:
                case "end":
                  return _context5.stop();
              }
            }, _callee5);
          })));
          browser.storage.onChanged.addListener(function (changes) {
            if (changes[SPACE_REGISTRY_KEY]) {
              popupState.spaceRegistry = changes[SPACE_REGISTRY_KEY].newValue || {};
              renderSpaceList(spaceList);
            }
            if (changes[SPACE_SORT_KEY]) {
              popupState.sortBy = changes[SPACE_SORT_KEY].newValue === SPACE_SORT_CATEGORY ? SPACE_SORT_CATEGORY : SPACE_SORT_NAME;
              spaceSortBy.value = popupState.sortBy;
              renderSpaceList(spaceList);
            }
            if (changes[SPACE_NUKED_POSTS_KEY]) {
              popupState.nukedPosts = changes[SPACE_NUKED_POSTS_KEY].newValue || {};
              renderNukedPostCount(nukedPostCount);
            }
            if (changes[NUKED_POST_RETENTION_DAYS_KEY]) {
              popupState.nukedPostRetentionDays = normalizeRetentionDays(changes[NUKED_POST_RETENTION_DAYS_KEY].newValue, defaults[NUKED_POST_RETENTION_DAYS_KEY]);
              nukedPostRetentionDays.value = popupState.nukedPostRetentionDays;
            }
            if (changes[MAX_REMEMBERED_NUKED_POSTS_KEY]) {
              popupState.maxRememberedNukedPosts = normalizeMaxRememberedNukedPosts(changes[MAX_REMEMBERED_NUKED_POSTS_KEY].newValue, defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]);
              maxRememberedNukedPosts.value = popupState.maxRememberedNukedPosts;
            }
          });
          renderSpaceList(spaceList);
        case 46:
        case "end":
          return _context6.stop();
      }
    }, _callee6);
  }));
  return _init.apply(this, arguments);
}
function showStatus(element, message) {
  element.textContent = message;
  element.hidden = false;
  clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = setTimeout(function () {
    element.hidden = true;
    element.textContent = '';
  }, 1200);
}
function renderNukedPostCount(element) {
  var count = Object.keys(popupState.nukedPosts || {}).length;
  element.textContent = "".concat(count, " history entr").concat(count === 1 ? 'y' : 'ies');
}
function updateSpaceCategory(_x, _x2, _x3) {
  return _updateSpaceCategory.apply(this, arguments);
}
function _updateSpaceCategory() {
  _updateSpaceCategory = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee7(spaceKey, category, container) {
    var _popupState$spaceRegi;
    var existingRecord, nextRecord;
    return _regeneratorRuntime().wrap(function _callee7$(_context7) {
      while (1) switch (_context7.prev = _context7.next) {
        case 0:
          existingRecord = (_popupState$spaceRegi = popupState.spaceRegistry) === null || _popupState$spaceRegi === void 0 ? void 0 : _popupState$spaceRegi[spaceKey];
          if (existingRecord) {
            _context7.next = 3;
            break;
          }
          return _context7.abrupt("return");
        case 3:
          nextRecord = buildSpaceRecord(existingRecord, category, existingRecord);
          if (nextRecord) {
            _context7.next = 6;
            break;
          }
          return _context7.abrupt("return");
        case 6:
          popupState.spaceRegistry = _objectSpread(_objectSpread({}, popupState.spaceRegistry), {}, _defineProperty({}, spaceKey, nextRecord));
          renderSpaceList(container);
          _context7.next = 10;
          return browser.storage.local.set(_defineProperty({}, SPACE_REGISTRY_KEY, popupState.spaceRegistry));
        case 10:
        case "end":
          return _context7.stop();
      }
    }, _callee7);
  }));
  return _updateSpaceCategory.apply(this, arguments);
}
function renderSpaceList(container) {
  var records = sortSpaceRecords(Object.values(popupState.spaceRegistry || {}), popupState.sortBy);
  container.innerHTML = '';
  if (!records.length) {
    var empty = document.createElement('div');
    empty.className = 'space-empty';
    empty.textContent = 'No spaces have been categorized yet.';
    container.appendChild(empty);
    return;
  }
  var fragment = document.createDocumentFragment();
  var _iterator = _createForOfIteratorHelper(records),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var record = _step.value;
      var row = document.createElement('article');
      row.className = 'space-item';
      var meta = document.createElement('div');
      meta.className = 'space-item-meta';
      var top = document.createElement('div');
      top.className = 'space-item-top';
      var name = document.createElement('div');
      name.className = 'space-item-name';
      name.textContent = record.name || record.slug || record.url;
      var category = document.createElement('span');
      category.className = "space-item-category space-item-category--".concat(record.category || 'unknown');
      category.textContent = getSpaceCategoryShortLabel(record.category);
      top.appendChild(name);
      top.appendChild(category);
      var link = document.createElement('a');
      link.className = 'space-item-link';
      link.href = record.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = record.slug || record.url;
      meta.appendChild(top);
      meta.appendChild(link);
      var controls = document.createElement('div');
      controls.className = 'popup-space-segmented';
      var _iterator2 = _createForOfIteratorHelper(SPACE_CATEGORIES),
        _step2;
      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var option = _step2.value;
          var button = document.createElement('button');
          var isActive = option === record.category;
          button.type = 'button';
          button.className = 'popup-space-button';
          button.dataset.spaceKey = record.key;
          button.dataset.category = option;
          button.dataset.active = isActive ? 'true' : 'false';
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          button.textContent = getSpaceCategoryShortLabel(option);
          if (isActive) {
            button.classList.add('popup-space-button--active', "popup-space-button--".concat(option));
          }
          controls.appendChild(button);
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
      row.appendChild(meta);
      row.appendChild(controls);
      fragment.appendChild(row);
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  container.appendChild(fragment);
}
})();

/******/ })()
;