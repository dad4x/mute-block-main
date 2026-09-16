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
    }));
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
  isExplicitSecurityVerificationRecord: isExplicitSecurityVerificationRecord,
  isRetryableJobFailure: isRetryableJobFailure,
  isRetryableJobFailureFromProgress: isRetryableJobFailureFromProgress,
  isTerminalJobStatus: isTerminalJobStatus,
  isTransientProgressStatus: isTransientProgressStatus,
  makeCanonicalSubject: makeCanonicalSubject,
  makeEmptyJobMilestones: makeEmptyJobMilestones,
  makeJobDedupeKey: makeJobDedupeKey,
  mapProgressToCoordinatorState: mapProgressToCoordinatorState,
  mapProgressToJobState: mapProgressToJobState,
  reduceJobEvent: reduceJobEvent,
  upgradeCoordinatorQueueItem: upgradeCoordinatorQueueItem
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
  // coordinator.js dashboard-to-service-worker message round trips
  // (sendRuntimeMessageWithTimeout's own default, and the heavier
  // mutation-style calls that explicitly opt into a longer budget)
  COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS: 5000,
  COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS: 10000,
  // sw.js
  WAIT_FOR_USER_START_DURABLE_ACTIVATION_DEFAULT_TIMEOUT_MS: 15000
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
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
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
var SPACE_REGISTRY_KEY = 'mbSpaceRegistry';
var HIDDEN_RUNS_KEY = 'mbCoordinatorHiddenRunIds';
var COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled';
var COORDINATOR_PAUSED_KEY = 'mbCoordinatorPaused';
var QUEUED_ACTION_SURFACE_STATE_KEY = 'mbQueuedActionSurfaceState';
var QUEUED_ACTION_SURFACE_COORDINATOR_HASH = '#worker-window';
var COORDINATOR_RESUME_INTERVAL_MS = 5000;
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
  outliers: []
};
// Keyed by rowKey+attemptId, separate from state.outliers: a terminal row's
// duration never changes, so without this a manually-cleared outlier would
// simply get re-detected and reappear on the very next refresh pass. Clearing
// dismisses that specific attempt permanently for this dashboard session
// (not persisted, same as everything else here) -- a new attempt (retry) or
// a different row is unaffected.
var dismissedOutlierKeys = new Set();
var resumeCoordinatorQueueTimer = null;
var resumeCoordinatorQueuePromise = null;
var dashboardCompactRefreshTimer = null;
var dashboardCompactRefreshScheduledTimer = null;
var dashboardCompactRefreshPromise = null;
var retryFailedActive = false;
var retryFailedLastResult = null;
var currentWorkPausePending = '';
addEventListener('load', function () {
  void init();
});
function init() {
  return _init.apply(this, arguments);
}
function _init() {
  _init = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee() {
    var _document$getElementB, _document$getElementB2, _document$getElementB3, _document$getElementB4, _document$getElementB5, _document$getElementB6, _document$getElementB7, _document$getElementB8, _document$getElementB9, _document$getElementB10;
    var manifest, ready;
    return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          manifest = browser.runtime.getManifest();
          document.getElementById('appVersion').textContent = "v".concat(manifest.version);
          _context.next = 4;
          return registerQueuedWorkerActionSurfacePage();
        case 4:
          (_document$getElementB = document.getElementById('clearEventsButton')) === null || _document$getElementB === void 0 || _document$getElementB.addEventListener('click', function () {
            void clearEvents();
          });
          (_document$getElementB2 = document.getElementById('clearCompletedRunsButton')) === null || _document$getElementB2 === void 0 || _document$getElementB2.addEventListener('click', function () {
            void clearCompletedRuns();
          });
          (_document$getElementB3 = document.getElementById('clearOutliersButton')) === null || _document$getElementB3 === void 0 || _document$getElementB3.addEventListener('click', function () {
            clearOutliers();
          });
          (_document$getElementB4 = document.getElementById('resetMetricsButton')) === null || _document$getElementB4 === void 0 || _document$getElementB4.addEventListener('click', function () {
            void resetMetrics();
          });
          (_document$getElementB5 = document.getElementById('retryFailedButton')) === null || _document$getElementB5 === void 0 || _document$getElementB5.addEventListener('click', function () {
            void toggleRetryFailed();
          });
          (_document$getElementB6 = document.getElementById('requeueFailedButton')) === null || _document$getElementB6 === void 0 || _document$getElementB6.addEventListener('click', function () {
            void requeueFailed();
          });
          (_document$getElementB7 = document.getElementById('pauseCurrentWorkButton')) === null || _document$getElementB7 === void 0 || _document$getElementB7.addEventListener('click', function () {
            void toggleCurrentWorkPause();
          });
          (_document$getElementB8 = document.getElementById('cancelCurrentWorkButton')) === null || _document$getElementB8 === void 0 || _document$getElementB8.addEventListener('click', function () {
            void cancelCurrentWork();
          });
          (_document$getElementB9 = document.getElementById('startCoordinatorButton')) === null || _document$getElementB9 === void 0 || _document$getElementB9.addEventListener('click', function () {
            void startCoordinatorQueue();
          });
          (_document$getElementB10 = document.getElementById('openPreferencesButton')) === null || _document$getElementB10 === void 0 || _document$getElementB10.addEventListener('click', function () {
            void openPreferences();
          });
          installPanelToggleListeners();
          installPanelWheelScrollListeners();
          installDashboardRuntimeRefreshListener();
          installCompactStorageRefreshPolling();
          render();
          _context.next = 21;
          return announceCoordinatorPageReady();
        case 21:
          ready = _context.sent;
          setQuoraVisitRequirement(!ready || !!(ready !== null && ready !== void 0 && ready.requiresQuoraVisit));
          _context.prev = 23;
          _context.next = 26;
          return loadState();
        case 26:
          captureQuoraActivationMetricBaseline();
          state.loadError = '';
          _context.next = 33;
          break;
        case 30:
          _context.prev = 30;
          _context.t0 = _context["catch"](23);
          state.loadError = (_context.t0 === null || _context.t0 === void 0 ? void 0 : _context.t0.message) || "".concat(_context.t0 || '') || 'Dashboard storage load failed';
        case 33:
          state.loading = false;
          if (retryFailedActive && !retryFailedLastResult) {
            retryFailedLastResult = {
              reason: 'resumed'
            };
          }
          render();
        case 36:
        case "end":
          return _context.stop();
      }
    }, _callee, null, [[23, 30]]);
  }));
  return _init.apply(this, arguments);
}
function isQueuedWorkerActionSurfacePage() {
  var _globalThis$location;
  return "".concat(((_globalThis$location = globalThis.location) === null || _globalThis$location === void 0 ? void 0 : _globalThis$location.hash) || '') === QUEUED_ACTION_SURFACE_COORDINATOR_HASH;
}
function registerQueuedWorkerActionSurfacePage() {
  return _registerQueuedWorkerActionSurfacePage.apply(this, arguments);
}
function _registerQueuedWorkerActionSurfacePage() {
  _registerQueuedWorkerActionSurfacePage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
    var _browser$storage, _browser$tabs, _browser$tabs$getCurr, _browser$windows, _currentWindow$tabs$f, _currentWindow$tabs$f2, _browser$storage2;
    var currentTab, currentWindow, windowId, anchorTabId;
    return _regeneratorRuntime().wrap(function _callee2$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          if (isQueuedWorkerActionSurfacePage()) {
            _context2.next = 2;
            break;
          }
          return _context2.abrupt("return", false);
        case 2:
          if (((_browser$storage = browser.storage) === null || _browser$storage === void 0 || (_browser$storage = _browser$storage.session) === null || _browser$storage === void 0 ? void 0 : _browser$storage.set) !== undefined) {
            document.title = 'Mute Block Worker';
          }
          _context2.next = 5;
          return (_browser$tabs = browser.tabs) === null || _browser$tabs === void 0 || (_browser$tabs$getCurr = _browser$tabs.getCurrent) === null || _browser$tabs$getCurr === void 0 ? void 0 : _browser$tabs$getCurr.call(_browser$tabs)["catch"](function () {
            return null;
          });
        case 5:
          currentTab = _context2.sent;
          if (!(!(currentTab !== null && currentTab !== void 0 && currentTab.windowId) && (_browser$windows = browser.windows) !== null && _browser$windows !== void 0 && _browser$windows.getCurrent)) {
            _context2.next = 12;
            break;
          }
          _context2.next = 9;
          return browser.windows.getCurrent({
            populate: true
          })["catch"](function () {
            return null;
          });
        case 9:
          _context2.t0 = _context2.sent;
          _context2.next = 13;
          break;
        case 12:
          _context2.t0 = null;
        case 13:
          currentWindow = _context2.t0;
          windowId = Number.parseInt((currentTab === null || currentTab === void 0 ? void 0 : currentTab.windowId) || (currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.id), 10) || 0;
          anchorTabId = Number.parseInt(currentTab === null || currentTab === void 0 ? void 0 : currentTab.id, 10) || (Array.isArray(currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.tabs) ? Number.parseInt(((_currentWindow$tabs$f = currentWindow.tabs.find(function (tab) {
            return tab === null || tab === void 0 ? void 0 : tab.active;
          })) === null || _currentWindow$tabs$f === void 0 ? void 0 : _currentWindow$tabs$f.id) || ((_currentWindow$tabs$f2 = currentWindow.tabs.find(function (tab) {
            return tab === null || tab === void 0 ? void 0 : tab.id;
          })) === null || _currentWindow$tabs$f2 === void 0 ? void 0 : _currentWindow$tabs$f2.id), 10) || 0 : 0);
          if (!(!windowId || !((_browser$storage2 = browser.storage) !== null && _browser$storage2 !== void 0 && (_browser$storage2 = _browser$storage2.session) !== null && _browser$storage2 !== void 0 && _browser$storage2.set))) {
            _context2.next = 18;
            break;
          }
          return _context2.abrupt("return", false);
        case 18:
          _context2.next = 20;
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
          return _context2.abrupt("return", true);
        case 21:
        case "end":
          return _context2.stop();
      }
    }, _callee2);
  }));
  return _registerQueuedWorkerActionSurfacePage.apply(this, arguments);
}
function installCompactStorageRefreshPolling() {
  if (dashboardCompactRefreshTimer) return;
  addEventListener('pagehide', stopCompactStorageRefreshPolling);
  addEventListener('beforeunload', stopCompactStorageRefreshPolling);
  dashboardCompactRefreshTimer = setInterval(function () {
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
function installDashboardRuntimeRefreshListener() {
  var _browser$runtime;
  if (!((_browser$runtime = browser.runtime) !== null && _browser$runtime !== void 0 && (_browser$runtime = _browser$runtime.onMessage) !== null && _browser$runtime !== void 0 && _browser$runtime.addListener)) return;
  browser.runtime.onMessage.addListener(function (message) {
    if ("".concat((message === null || message === void 0 ? void 0 : message.action) || '') !== 'coordinator-dashboard-state-changed') return;
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
  _refreshDashboardStateFromCompactStorage = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee3() {
    return _regeneratorRuntime().wrap(function _callee3$(_context3) {
      while (1) switch (_context3.prev = _context3.next) {
        case 0:
          if (!state.loading) {
            _context3.next = 2;
            break;
          }
          return _context3.abrupt("return", false);
        case 2:
          if (!dashboardCompactRefreshPromise) {
            _context3.next = 4;
            break;
          }
          return _context3.abrupt("return", dashboardCompactRefreshPromise);
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
          return _context3.abrupt("return", dashboardCompactRefreshPromise);
        case 6:
        case "end":
          return _context3.stop();
      }
    }, _callee3);
  }));
  return _refreshDashboardStateFromCompactStorage.apply(this, arguments);
}
function sendRuntimeMessageWithTimeout(_x) {
  return _sendRuntimeMessageWithTimeout.apply(this, arguments);
}
function _sendRuntimeMessageWithTimeout() {
  _sendRuntimeMessageWithTimeout = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee4(message) {
    var fallback,
      timeoutMs,
      timeoutMarker,
      timeout,
      result,
      _args4 = arguments;
    return _regeneratorRuntime().wrap(function _callee4$(_context4) {
      while (1) switch (_context4.prev = _context4.next) {
        case 0:
          fallback = _args4.length > 1 && _args4[1] !== undefined ? _args4[1] : null;
          timeoutMs = _args4.length > 2 && _args4[2] !== undefined ? _args4[2] : COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS;
          timeoutMarker = {
            timedOut: true
          };
          timeout = new Promise(function (resolve) {
            return setTimeout(function () {
              return resolve(timeoutMarker);
            }, timeoutMs);
          });
          _context4.next = 6;
          return Promise.race([browser.runtime.sendMessage(message), timeout]);
        case 6:
          result = _context4.sent;
          return _context4.abrupt("return", result === timeoutMarker ? fallback : result);
        case 8:
        case "end":
          return _context4.stop();
      }
    }, _callee4);
  }));
  return _sendRuntimeMessageWithTimeout.apply(this, arguments);
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
  _openPreferences = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
    var url;
    return _regeneratorRuntime().wrap(function _callee5$(_context5) {
      while (1) switch (_context5.prev = _context5.next) {
        case 0:
          url = browser.runtime.getURL('popup.html');
          _context5.next = 3;
          return browser.tabs.create({
            url: url,
            active: true
          })["catch"](function () {
            window.open(url, '_blank', 'noopener');
          });
        case 3:
        case "end":
          return _context5.stop();
      }
    }, _callee5);
  }));
  return _openPreferences.apply(this, arguments);
}
function startCoordinatorQueue() {
  return _startCoordinatorQueue.apply(this, arguments);
}
function _startCoordinatorQueue() {
  _startCoordinatorQueue = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
    var button, result;
    return _regeneratorRuntime().wrap(function _callee6$(_context6) {
      while (1) switch (_context6.prev = _context6.next) {
        case 0:
          button = document.getElementById('startCoordinatorButton');
          flashButton(button);
          retryFailedLastResult = {
            reason: 'starting-current-work'
          };
          render();
          _context6.next = 6;
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
          result = _context6.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'start-current-work-failed' : (result === null || result === void 0 ? void 0 : result.reason) || 'start-current-work-scheduled'
          };
          if (result && !result.requiresQuoraVisit) {
            setQuoraVisitRequirement(false);
          }
          _context6.next = 11;
          return loadState();
        case 11:
          render();
        case 12:
        case "end":
          return _context6.stop();
      }
    }, _callee6);
  }));
  return _startCoordinatorQueue.apply(this, arguments);
}
function announceCoordinatorPageReady() {
  return _announceCoordinatorPageReady.apply(this, arguments);
}
function _announceCoordinatorPageReady() {
  _announceCoordinatorPageReady = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee7() {
    return _regeneratorRuntime().wrap(function _callee7$(_context7) {
      while (1) switch (_context7.prev = _context7.next) {
        case 0:
          _context7.prev = 0;
          _context7.next = 3;
          return sendRuntimeMessageWithTimeout({
            action: 'coordinator-page-ready'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 3:
          return _context7.abrupt("return", _context7.sent);
        case 6:
          _context7.prev = 6;
          _context7.t0 = _context7["catch"](0);
        case 8:
          return _context7.abrupt("return", null);
        case 9:
        case "end":
          return _context7.stop();
      }
    }, _callee7, null, [[0, 6]]);
  }));
  return _announceCoordinatorPageReady.apply(this, arguments);
}
function resetMetrics() {
  return _resetMetrics.apply(this, arguments);
}
function _resetMetrics() {
  _resetMetrics = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee8() {
    var result;
    return _regeneratorRuntime().wrap(function _callee8$(_context8) {
      while (1) switch (_context8.prev = _context8.next) {
        case 0:
          _context8.prev = 0;
          _context8.next = 3;
          return sendRuntimeMessageWithTimeout({
            action: 'reset-queue-wakeup-metrics'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 3:
          result = _context8.sent;
          if (!(result !== null && result !== void 0 && result.reset)) {
            _context8.next = 8;
            break;
          }
          _context8.next = 7;
          return loadState();
        case 7:
          render();
        case 8:
          _context8.next = 13;
          break;
        case 10:
          _context8.prev = 10;
          _context8.t0 = _context8["catch"](0);
          console.warn('Failed to reset metrics', _context8.t0);
        case 13:
        case "end":
          return _context8.stop();
      }
    }, _callee8, null, [[0, 10]]);
  }));
  return _resetMetrics.apply(this, arguments);
}
function loadState() {
  return _loadState.apply(this, arguments);
}
function _loadState() {
  _loadState = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee9() {
    var stored;
    return _regeneratorRuntime().wrap(function _callee9$(_context9) {
      while (1) switch (_context9.prev = _context9.next) {
        case 0:
          _context9.next = 2;
          return browser.storage.local.get(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty(_defineProperty({}, COORDINATOR_QUEUE_VIEW_KEY, {}), COORDINATOR_RUNS_KEY, {}), COORDINATOR_EVENTS_KEY, []), QUEUE_WAKEUP_METRICS_VIEW_KEY, {}), SPACE_REGISTRY_KEY, {}), HIDDEN_RUNS_KEY, []), COORDINATOR_RETRY_FAILED_ENABLED_KEY, false), COORDINATOR_PAUSED_KEY, false));
        case 2:
          stored = _context9.sent;
          if (!hasCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])) {
            _context9.next = 7;
            break;
          }
          applyCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY]);
          _context9.next = 9;
          break;
        case 7:
          _context9.next = 9;
          return refreshCompactQueueView();
        case 9:
          state.runs = normalizeObject(stored[COORDINATOR_RUNS_KEY]);
          state.events = normalizeEvents(stored[COORDINATOR_EVENTS_KEY]);
          if (!hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
            _context9.next = 15;
            break;
          }
          state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY]);
          _context9.next = 17;
          break;
        case 15:
          _context9.next = 17;
          return refreshCompactMetricsView();
        case 17:
          state.spaceRegistry = normalizeObject(stored[SPACE_REGISTRY_KEY]);
          state.hiddenRunIds = normalizeStringList(stored[HIDDEN_RUNS_KEY]);
          retryFailedActive = !!stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY];
          state.paused = !!stored[COORDINATOR_PAUSED_KEY];
        case 21:
        case "end":
          return _context9.stop();
      }
    }, _callee9);
  }));
  return _loadState.apply(this, arguments);
}
function refreshCompactQueueView() {
  return _refreshCompactQueueView.apply(this, arguments);
}
function _refreshCompactQueueView() {
  _refreshCompactQueueView = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee10() {
    var result, stored;
    return _regeneratorRuntime().wrap(function _callee10$(_context10) {
      while (1) switch (_context10.prev = _context10.next) {
        case 0:
          _context10.next = 2;
          return sendRuntimeMessageWithTimeout({
            action: 'refresh-coordinator-queue-view',
            reason: 'dashboard-load-missing-view'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS);
        case 2:
          result = _context10.sent;
          if (!hasCoordinatorQueueView(result === null || result === void 0 ? void 0 : result.view)) {
            _context10.next = 6;
            break;
          }
          applyCoordinatorQueueView(result.view);
          return _context10.abrupt("return", true);
        case 6:
          _context10.next = 8;
          return browser.storage.local.get(_defineProperty({}, COORDINATOR_QUEUE_VIEW_KEY, {}));
        case 8:
          stored = _context10.sent;
          if (!hasCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])) {
            _context10.next = 12;
            break;
          }
          applyCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY]);
          return _context10.abrupt("return", true);
        case 12:
          applyCoordinatorQueueView({
            version: 1,
            updatedAt: Date.now(),
            total: 0,
            counts: {},
            itemLimit: 0,
            truncated: false,
            items: []
          });
          return _context10.abrupt("return", false);
        case 14:
        case "end":
          return _context10.stop();
      }
    }, _callee10);
  }));
  return _refreshCompactQueueView.apply(this, arguments);
}
function hasCoordinatorQueueView() {
  var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : state.queueView;
  return !!value && _typeof(value) === 'object' && !Array.isArray(value) && Number.parseInt(value.version, 10) >= 1 && Array.isArray(value.items);
}
function refreshCompactMetricsView() {
  return _refreshCompactMetricsView.apply(this, arguments);
}
function _refreshCompactMetricsView() {
  _refreshCompactMetricsView = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee11() {
    var result, stored;
    return _regeneratorRuntime().wrap(function _callee11$(_context11) {
      while (1) switch (_context11.prev = _context11.next) {
        case 0:
          _context11.next = 2;
          return sendRuntimeMessageWithTimeout({
            action: 'refresh-queue-wakeup-metrics-view',
            reason: 'dashboard-load-missing-view'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS);
        case 2:
          result = _context11.sent;
          if (!hasQueueWakeupMetricsView(result === null || result === void 0 ? void 0 : result.view)) {
            _context11.next = 6;
            break;
          }
          state.metrics = normalizeMetrics(result.view);
          return _context11.abrupt("return", true);
        case 6:
          _context11.next = 8;
          return browser.storage.local.get(_defineProperty({}, QUEUE_WAKEUP_METRICS_VIEW_KEY, {}));
        case 8:
          stored = _context11.sent;
          if (!hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
            _context11.next = 12;
            break;
          }
          state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY]);
          return _context11.abrupt("return", true);
        case 12:
          state.metrics = normalizeMetrics({});
          return _context11.abrupt("return", false);
        case 14:
        case "end":
          return _context11.stop();
      }
    }, _callee11);
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
    return Object.entries(state.queueCounts || {}).filter(function (_ref) {
      var _ref2 = _slicedToArray(_ref, 1),
        status = _ref2[0];
      return isTerminalQueueStatus(status);
    }).reduce(function (total, _ref3) {
      var _ref4 = _slicedToArray(_ref3, 2),
        count = _ref4[1];
      return total + (Number(count) || 0);
    }, 0);
  }
  return queueItems.filter(isTerminalQueueItem).length;
}
function getQueueTotalCount() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  return hasCoordinatorQueueView() ? Number(state.queueTotal) || queueItems.length : queueItems.length;
}
function getBlockOutcomeCounts() {
  var metricsDocument = state.metrics || {};
  var counters = (metricsDocument.currentEpoch || metricsDocument).counters || {};
  var reallyBlockedCount = getMetricCounter(counters, 'profileAction.reallyBlocked.count');
  var alreadyBlockedCount = getMetricCounter(counters, 'profileAction.alreadyBlocked.count');
  var total = reallyBlockedCount + alreadyBlockedCount;
  return {
    reallyBlockedCount: reallyBlockedCount,
    alreadyBlockedCount: alreadyBlockedCount,
    total: total
  };
}
function formatBlockOutcomeCount() {
  var count = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var total = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  return total > 0 ? "".concat(count, " (").concat(formatPercent(count / total), ")") : "".concat(count);
}
function render() {
  var queueItems = getDisplayQueueItems();
  var runItems = getDisplayRuns(queueItems);
  refreshQuoraVisitRequirement(queueItems);
  var queuedCount = getQueueStatusCount('queued', queueItems);
  var activeCount = getQueueStatusCount('opening', queueItems) + getQueueStatusCount('active', queueItems) + getQueueStatusCount('acting', queueItems) + getQueueStatusCount('settling', queueItems);
  var terminalCount = getQueueTerminalCount(queueItems);
  var secondsPerBlock = getSecondsPerActualBlock(queueItems, getCurrentMetricsEpochStartedAt());
  var activationHandoff = getActivationHandoffSeconds(queueItems, getCurrentMetricsEpochStartedAt());
  var failedCount = getQueueStatusCount('failed', queueItems);
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
  setText('activationHandoffSeconds', formatSecondsPerBlock(activationHandoff));
  var blockOutcomeCounts = getBlockOutcomeCounts();
  setText('reallyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.reallyBlockedCount, blockOutcomeCounts.total));
  setText('alreadyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.alreadyBlockedCount, blockOutcomeCounts.total));
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
  renderQueue(queueItems);
  checkCoordinatorOutliers(queueItems);
  renderOutliers();
  syncCoordinatorQueueResume(queueItems);
  syncRetryFailedControls(queueItems, retryableFailedCount, exhaustedRetryableFailedCount);
  syncRequeueFailedControls(failedCount);
  syncCurrentWorkPauseControls(queueItems);
  syncStartCoordinatorControls();
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
  _clearEvents = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee12() {
    return _regeneratorRuntime().wrap(function _callee12$(_context12) {
      while (1) switch (_context12.prev = _context12.next) {
        case 0:
          _context12.next = 2;
          return browser.storage.local.set(_defineProperty({}, COORDINATOR_EVENTS_KEY, []));
        case 2:
          state.events = [];
          render();
        case 4:
        case "end":
          return _context12.stop();
      }
    }, _callee12);
  }));
  return _clearEvents.apply(this, arguments);
}
function clearCompletedRuns() {
  return _clearCompletedRuns.apply(this, arguments);
}
function _clearCompletedRuns() {
  _clearCompletedRuns = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee13() {
    var runItems, nextHiddenRunIds, _iterator8, _step8, run, runId;
    return _regeneratorRuntime().wrap(function _callee13$(_context13) {
      while (1) switch (_context13.prev = _context13.next) {
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
          _context13.next = 7;
          return browser.storage.local.set(_defineProperty({}, HIDDEN_RUNS_KEY, state.hiddenRunIds));
        case 7:
          render();
        case 8:
        case "end":
          return _context13.stop();
      }
    }, _callee13);
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
  var _ref5 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
    _ref5$hasPendingWork = _ref5.hasPendingWork,
    hasPendingWork = _ref5$hasPendingWork === void 0 ? false : _ref5$hasPendingWork,
    _ref5$hasActiveWork = _ref5.hasActiveWork,
    hasActiveWork = _ref5$hasActiveWork === void 0 ? false : _ref5$hasActiveWork;
  if (!hasPendingWork) return '';
  if (state.requiresQuoraVisit) return 'waiting for first Quora page';
  if (hasActiveWork) return 'waiting for current work to idle';
  return 'queued work is waiting to start';
}
function syncRequeueFailedControls() {
  var failedCount = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var button = document.getElementById('requeueFailedButton');
  if (!button) return;
  button.disabled = failedCount <= 0;
  button.title = failedCount > 0 ? "Reset and requeue ".concat(failedCount, " failed Current Work job").concat(failedCount === 1 ? '' : 's') : 'No failed Current Work jobs to requeue';
}
function requeueFailed() {
  return _requeueFailed.apply(this, arguments);
}
function _requeueFailed() {
  _requeueFailed = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee14() {
    var failedCount, button, result;
    return _regeneratorRuntime().wrap(function _callee14$(_context14) {
      while (1) switch (_context14.prev = _context14.next) {
        case 0:
          failedCount = getQueueStatusCount('failed', getDisplayQueueItems());
          if (!(failedCount <= 0)) {
            _context14.next = 5;
            break;
          }
          retryFailedLastResult = {
            reason: 'no-failed-current-work'
          };
          render();
          return _context14.abrupt("return");
        case 5:
          button = document.getElementById('requeueFailedButton');
          if (button) button.disabled = true;
          retryFailedLastResult = {
            reason: 'requeueing-failed'
          };
          render();
          _context14.next = 11;
          return sendRuntimeMessageWithTimeout({
            action: 'requeue-coordinator-failed'
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 11:
          result = _context14.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'requeue-failed' : "requeued-".concat(Number.parseInt(result === null || result === void 0 ? void 0 : result.selected, 10) || 0)
          };
          _context14.next = 15;
          return loadState();
        case 15:
          render();
        case 16:
        case "end":
          return _context14.stop();
      }
    }, _callee14);
  }));
  return _requeueFailed.apply(this, arguments);
}
function cancelCurrentWorkItem() {
  return _cancelCurrentWorkItem.apply(this, arguments);
}
function _cancelCurrentWorkItem() {
  _cancelCurrentWorkItem = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee15() {
    var _result$canceledUrls, _result$canceledWorkK;
    var item,
      storageKey,
      profileHref,
      result,
      _args15 = arguments;
    return _regeneratorRuntime().wrap(function _callee15$(_context15) {
      while (1) switch (_context15.prev = _context15.next) {
        case 0:
          item = _args15.length > 0 && _args15[0] !== undefined ? _args15[0] : {};
          if (isPendingQueueStatus("".concat((item === null || item === void 0 ? void 0 : item.status) || '').trim())) {
            _context15.next = 3;
            break;
          }
          return _context15.abrupt("return");
        case 3:
          storageKey = "".concat(item.storageKey || '').trim();
          profileHref = getQueueItemHref('', item);
          retryFailedLastResult = {
            reason: 'canceling-one-current-work'
          };
          render();
          _context15.next = 9;
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
          result = _context15.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'cancel-one-current-work-failed' : "canceled-".concat((Number.parseInt(result === null || result === void 0 || (_result$canceledUrls = result.canceledUrls) === null || _result$canceledUrls === void 0 ? void 0 : _result$canceledUrls.length, 10) || 0) + (Number.parseInt(result === null || result === void 0 || (_result$canceledWorkK = result.canceledWorkKeys) === null || _result$canceledWorkK === void 0 ? void 0 : _result$canceledWorkK.length, 10) || 0))
          };
          _context15.next = 13;
          return loadState();
        case 13:
          render();
        case 14:
        case "end":
          return _context15.stop();
      }
    }, _callee15);
  }));
  return _cancelCurrentWorkItem.apply(this, arguments);
}
function requeueFailedItem() {
  return _requeueFailedItem.apply(this, arguments);
}
function _requeueFailedItem() {
  _requeueFailedItem = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee16() {
    var item,
      storageKey,
      profileHref,
      result,
      _args16 = arguments;
    return _regeneratorRuntime().wrap(function _callee16$(_context16) {
      while (1) switch (_context16.prev = _context16.next) {
        case 0:
          item = _args16.length > 0 && _args16[0] !== undefined ? _args16[0] : {};
          if (!("".concat((item === null || item === void 0 ? void 0 : item.status) || '') !== 'failed')) {
            _context16.next = 3;
            break;
          }
          return _context16.abrupt("return");
        case 3:
          storageKey = "".concat(item.storageKey || '').trim();
          profileHref = getQueueItemHref('', item);
          retryFailedLastResult = {
            reason: 'requeueing-one-failed'
          };
          render();
          _context16.next = 9;
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
        case 9:
          result = _context16.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'requeue-failed' : "requeued-".concat(Number.parseInt(result === null || result === void 0 ? void 0 : result.selected, 10) || 0)
          };
          _context16.next = 13;
          return loadState();
        case 13:
          render();
        case 14:
        case "end":
          return _context16.stop();
      }
    }, _callee16);
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
    pauseButton.disabled = pausePending || resumePending || !state.paused && pendingCount <= 0;
    pauseButton.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    pauseButton.setAttribute('aria-busy', pausePending || resumePending ? 'true' : 'false');
    pauseButton.classList.toggle('clear-button--pause-active', state.paused);
    pauseButton.title = pausePending ? 'Pause request sent; waiting for Current Work to stop' : resumePending ? 'Resume request sent; waiting for Current Work to continue' : state.paused ? 'Resume paused Current Work' : pendingCount > 0 ? 'Pause Current Work without canceling jobs' : 'No pending Current Work to pause';
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
  _toggleCurrentWorkPause = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee17() {
    var button, wasPaused, action, result;
    return _regeneratorRuntime().wrap(function _callee17$(_context17) {
      while (1) switch (_context17.prev = _context17.next) {
        case 0:
          button = document.getElementById('pauseCurrentWorkButton');
          flashButton(button);
          wasPaused = state.paused;
          currentWorkPausePending = wasPaused ? 'resume' : 'pause';
          render();
          action = state.paused ? 'resume-paused-coordinator-nukes' : 'pause-coordinator-nukes';
          _context17.next = 8;
          return sendRuntimeMessageWithTimeout({
            action: action
          }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)["catch"](function (error) {
            return {
              error: (error === null || error === void 0 ? void 0 : error.message) || "".concat(error || '')
            };
          });
        case 8:
          result = _context17.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? wasPaused ? 'resume-failed' : 'pause-failed' : wasPaused ? 'resumed-current-work' : 'paused-current-work'
          };
          currentWorkPausePending = '';
          _context17.next = 13;
          return loadState();
        case 13:
          render();
        case 14:
        case "end":
          return _context17.stop();
      }
    }, _callee17);
  }));
  return _toggleCurrentWorkPause.apply(this, arguments);
}
function cancelCurrentWork() {
  return _cancelCurrentWork.apply(this, arguments);
}
function _cancelCurrentWork() {
  _cancelCurrentWork = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee18() {
    var _result$canceledUrls2, _result$canceledWorkK2;
    var pendingCount, button, result;
    return _regeneratorRuntime().wrap(function _callee18$(_context18) {
      while (1) switch (_context18.prev = _context18.next) {
        case 0:
          pendingCount = getPendingCurrentWorkItems().length;
          if (!(pendingCount <= 0)) {
            _context18.next = 5;
            break;
          }
          retryFailedLastResult = {
            reason: 'no-pending-current-work'
          };
          render();
          return _context18.abrupt("return");
        case 5:
          button = document.getElementById('cancelCurrentWorkButton');
          if (button) button.disabled = true;
          retryFailedLastResult = {
            reason: 'canceling-current-work'
          };
          render();
          _context18.next = 11;
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
          result = _context18.sent;
          retryFailedLastResult = {
            reason: result !== null && result !== void 0 && result.error ? 'cancel-current-work-failed' : "canceled-".concat((Number.parseInt(result === null || result === void 0 || (_result$canceledUrls2 = result.canceledUrls) === null || _result$canceledUrls2 === void 0 ? void 0 : _result$canceledUrls2.length, 10) || 0) + (Number.parseInt(result === null || result === void 0 || (_result$canceledWorkK2 = result.canceledWorkKeys) === null || _result$canceledWorkK2 === void 0 ? void 0 : _result$canceledWorkK2.length, 10) || 0))
          };
          _context18.next = 15;
          return loadState();
        case 15:
          render();
        case 16:
        case "end":
          return _context18.stop();
      }
    }, _callee18);
  }));
  return _cancelCurrentWork.apply(this, arguments);
}
function toggleRetryFailed() {
  return _toggleRetryFailed.apply(this, arguments);
}
function _toggleRetryFailed() {
  _toggleRetryFailed = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee19() {
    return _regeneratorRuntime().wrap(function _callee19$(_context19) {
      while (1) switch (_context19.prev = _context19.next) {
        case 0:
          if (!retryFailedActive) {
            _context19.next = 3;
            break;
          }
          stopRetryFailed('stopped');
          return _context19.abrupt("return");
        case 3:
          retryFailedActive = true;
          retryFailedLastResult = {
            reason: 'starting'
          };
          render();
          _context19.next = 8;
          return browser.storage.local.set(_defineProperty({}, COORDINATOR_RETRY_FAILED_ENABLED_KEY, true));
        case 8:
          retryFailedLastResult = {
            reason: 'service-worker-scheduled'
          };
          render();
        case 10:
        case "end":
          return _context19.stop();
      }
    }, _callee19);
  }));
  return _toggleRetryFailed.apply(this, arguments);
}
function stopRetryFailed() {
  var reason = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'idle';
  var _ref6 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
    _ref6$persist = _ref6.persist,
    persist = _ref6$persist === void 0 ? true : _ref6$persist;
  retryFailedActive = false;
  retryFailedLastResult = {
    reason: reason
  };
  render();
  if (persist) {
    void browser.storage.local.set(_defineProperty({}, COORDINATOR_RETRY_FAILED_ENABLED_KEY, false));
  }
}
function syncCoordinatorQueueResume() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  if (state.loading || state.requiresQuoraVisit) {
    if (resumeCoordinatorQueueTimer) {
      clearInterval(resumeCoordinatorQueueTimer);
      resumeCoordinatorQueueTimer = null;
    }
    return;
  }
  if (state.paused) {
    if (resumeCoordinatorQueueTimer) {
      clearInterval(resumeCoordinatorQueueTimer);
      resumeCoordinatorQueueTimer = null;
    }
    return;
  }
  var hasPendingDisplayWork = hasPendingCoordinatorQueueWork(queueItems);
  var hasPendingStoredWork = hasRawPendingCoordinatorQueueWork();
  if (!hasPendingDisplayWork && !hasPendingStoredWork) {
    if (resumeCoordinatorQueueTimer) {
      clearInterval(resumeCoordinatorQueueTimer);
      resumeCoordinatorQueueTimer = null;
    }
    return;
  }
  if (!resumeCoordinatorQueueTimer) {
    void resumeCoordinatorQueue();
    resumeCoordinatorQueueTimer = setInterval(function () {
      void resumeCoordinatorQueue();
    }, COORDINATOR_RESUME_INTERVAL_MS);
  }
}
function resumeCoordinatorQueue() {
  return _resumeCoordinatorQueue.apply(this, arguments);
}
function _resumeCoordinatorQueue() {
  _resumeCoordinatorQueue = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee20() {
    return _regeneratorRuntime().wrap(function _callee20$(_context20) {
      while (1) switch (_context20.prev = _context20.next) {
        case 0:
          if (!resumeCoordinatorQueuePromise) {
            _context20.next = 2;
            break;
          }
          return _context20.abrupt("return", resumeCoordinatorQueuePromise);
        case 2:
          resumeCoordinatorQueuePromise = sendRuntimeMessageWithTimeout({
            action: 'resume-coordinator-queue'
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)["catch"](function () {
            return null;
          })["finally"](function () {
            resumeCoordinatorQueuePromise = null;
          });
          return _context20.abrupt("return", resumeCoordinatorQueuePromise);
        case 4:
        case "end":
          return _context20.stop();
      }
    }, _callee20);
  }));
  return _resumeCoordinatorQueue.apply(this, arguments);
}
function getDisplayQueueItems() {
  return Object.entries(state.queue || {}).map(function (_ref7) {
    var _ref8 = _slicedToArray(_ref7, 2),
      key = _ref8[0],
      item = _ref8[1];
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
function getSecondsPerActualBlock() {
  var queueItems = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var epochStartedAt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var viewResult = getQueueViewSecondsPerActualBlock(epochStartedAt);
  if (viewResult) return viewResult;
  var minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0;
  var completedBlocks = queueItems.filter(function (item) {
    if (!isActualBlockSuccess(item)) return false;
    var terminalAt = getQueueItemTerminalTime(item);
    return terminalAt > 0 && (!minimumTerminalAt || terminalAt >= minimumTerminalAt);
  }).sort(function (left, right) {
    return getQueueItemTerminalTime(right) - getQueueItemTerminalTime(left);
  }).slice(0, SECONDS_PER_BLOCK_SAMPLE_LIMIT);
  if (!completedBlocks.length) return null;
  var durations = completedBlocks.map(getQueueItemActiveDurationMs).filter(function (duration) {
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
function getQueueViewSecondsPerActualBlock() {
  var _state$queueView;
  var epochStartedAt = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var summary = ((_state$queueView = state.queueView) === null || _state$queueView === void 0 ? void 0 : _state$queueView.actualBlockTiming) || null;
  if (!summary || _typeof(summary) !== 'object') return null;
  var requestedEpochStartedAt = Number.parseInt(epochStartedAt, 10) || 0;
  var summaryEpochStartedAt = Number.parseInt(summary.epochStartedAt, 10) || 0;
  if (requestedEpochStartedAt && summaryEpochStartedAt && summaryEpochStartedAt !== requestedEpochStartedAt) return null;
  var blocks = Number.parseInt(summary.blocks, 10) || 0;
  var elapsedMs = Number.parseInt(summary.elapsedMs, 10) || 0;
  var seconds = Number(summary.seconds);
  if (blocks <= 0 || elapsedMs <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    seconds: seconds,
    blocks: blocks,
    elapsedMs: elapsedMs
  };
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
    return sample.runId && sample.terminalAt > 0 && (!minimumTerminalAt || sample.terminalAt >= minimumTerminalAt);
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
  var _state$queueView2;
  var epochStartedAt = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
  var summary = ((_state$queueView2 = state.queueView) === null || _state$queueView2 === void 0 ? void 0 : _state$queueView2.activationHandoffTiming) || null;
  if (!summary || _typeof(summary) !== 'object') return null;
  var requestedEpochStartedAt = Number.parseInt(epochStartedAt, 10) || 0;
  var summaryEpochStartedAt = Number.parseInt(summary.epochStartedAt, 10) || 0;
  if (requestedEpochStartedAt && summaryEpochStartedAt && summaryEpochStartedAt !== requestedEpochStartedAt) return null;
  var handoffs = Number.parseInt(summary.handoffs, 10) || 0;
  var elapsedMs = Number.parseInt(summary.elapsedMs, 10) || 0;
  var seconds = Number(summary.seconds);
  if (handoffs <= 0 || elapsedMs <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    seconds: seconds,
    blocks: handoffs,
    elapsedMs: elapsedMs
  };
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
    }), buildBadge(run.status || 'unknown'), buildTextCell("".concat(Number.parseInt(run.itemCount, 10) || 0, " items")), buildTextCell(submittedAt ? formatDateTime(submittedAt) : ''));
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
  var payloadBytes = getMetricCounter(counters, 'storagePayload.write.total.bytes');
  var payloadCalls = getMetricCounter(counters, 'storagePayload.write.total.calls');
  var payloadQueueBytes = getMetricCounter(counters, 'storagePayload.write.queue.bytes');
  var payloadRunsBytes = getMetricCounter(counters, 'storagePayload.write.runs.bytes');
  var payloadProgressBytes = getMetricCounter(counters, 'storagePayload.write.progress.bytes');
  var payloadMaxBytes = getMetricCounter(counters, 'storagePayload.write.total.maxBytes');
  var readBytes = getMetricCounter(counters, 'storagePayload.read.total.bytes');
  var readCalls = getMetricCounter(counters, 'storagePayload.read.total.calls');
  var readQueueBytes = getMetricCounter(counters, 'storagePayload.read.queue.bytes');
  var readQueueViewBytes = getMetricCounter(counters, 'storagePayload.read.queueView.bytes');
  var readProgressBytes = getMetricCounter(counters, 'storagePayload.read.progress.bytes');
  var readMaxBytes = getMetricCounter(counters, 'storagePayload.read.total.maxBytes');
  var topReadPath = getTopStoragePayloadPath(counters, 'read');
  var topWritePath = getTopStoragePayloadPath(counters, 'write');
  var cloudflareChallenges = getMetricCounter(counters, 'cloudflareChallenge.detected');
  var duplicatePumps = getMetricCounter(counters, 'pump.noop.noPendingItems') + getMetricCounter(counters, 'pump.noop.executorAlreadyRunning') + getMetricCounter(counters, 'pump.noop.paused');
  var wakeups = nudgeSent + pumpRequested + reconcileRequested;
  var stalledQueued = queueItems.filter(function (item) {
    return "".concat((item === null || item === void 0 ? void 0 : item.status) || '') === 'queued';
  }).length;
  var epochReason = metrics.resetReason ? ", ".concat(metrics.resetReason) : '';
  var epochStarted = metrics.startedAt ? "Epoch ".concat(formatTime(metrics.startedAt)).concat(epochReason) : 'No metrics yet';
  setText('metricsUpdated', metrics.updatedAt ? "".concat(epochStarted, "; updated ").concat(formatTime(metrics.updatedAt)) : epochStarted);
  if (metricsGrid) {
    replaceChildren(metricsGrid, [buildMetricCard('Current epoch', metrics.resetReason || '--', "".concat(metrics.epochId || '')), buildMetricCard('Previous epochs', "".concat(previousEpochs.length), formatPreviousEpochSummary(previousEpochs[previousEpochs.length - 1])), buildMetricCard('Queue throttle', throttle.active ? 'active' : 'idle', throttle.active ? "level ".concat(throttle.level, "; retry ").concat(formatDuration(throttle.until - Date.now()), "; ").concat(throttle.reason || '') : throttle.lastProgressAt ? "recovered ".concat(formatTime(throttle.lastProgressAt)) : 'No page-load throttle active'), buildMetricCard('Wakeups/job', jobs ? formatRatio(wakeups / jobs) : '--', "".concat(wakeups, " wakeups / ").concat(jobs, " enqueued")), buildMetricCard('Nudge accept', nudgeSent ? formatPercent(nudgeAccepted / nudgeSent) : '--', "".concat(nudgeAccepted, " / ").concat(nudgeSent)), buildMetricCard('Pump yield', pumpRequested ? formatPercent(pumpChanged / pumpRequested) : '--', "".concat(pumpChanged, " changed / ").concat(pumpRequested)), buildMetricCard('Duplicate pumps', pumpRequested ? formatPercent(duplicatePumps / pumpRequested) : '--', "".concat(duplicatePumps, " no-op")), buildMetricCard('Reconciles/job', jobs ? formatRatio(reconcileRequested / jobs) : '--', "".concat(reconcileChanged, " reconcile changes")), buildMetricCard('Terminal jobs', "".concat(terminalJobs), "".concat(stalledQueued, " currently queued")), buildMetricCard('Cloudflare challenges', "".concat(cloudflareChallenges), jobs ? "".concat(formatPercent(cloudflareChallenges / jobs), " of ").concat(jobs, " enqueued jobs hit a bot-challenge interstitial") : 'No challenge interstitials seen yet'), buildMetricCard('Queue -> tab', formatPhaseAverage(phases.durableQueueToTabOpen), formatPhaseDetail(phases.durableQueueToTabOpen)), buildMetricCard('Tab -> claim', formatPhaseAverage(phases.tabOpenToClaimAccepted), formatPhaseDetail(phases.tabOpenToClaimAccepted)), buildMetricCard('Claim -> action', formatPhaseAverage(phases.claimAcceptedToActionStart), formatPhaseDetail(phases.claimAcceptedToActionStart)), buildMetricCard('Action -> terminal', formatPhaseAverage(phases.actionStartToTerminal), formatPhaseDetail(phases.actionStartToTerminal)), buildMetricCard('Terminal -> release', formatPhaseAverage(phases.terminalToSlotRelease), formatPhaseDetail(phases.terminalToSlotRelease)), buildMetricCard('Storage timeouts', storageStarted ? formatPercent(storageTimedOut / storageStarted) : "".concat(storageTimedOut), "".concat(storageTimedOut, " / ").concat(storageStarted, "; ").concat(storageFallbackReturned, " fallback returned")), buildMetricCard('Storage deadlines', storageStarted ? formatPercent(storageDeadlineMissed / storageStarted) : "".concat(storageDeadlineMissed), "".concat(storageDeadlineMissed, " missed; ").concat(getMetricCounter(counters, 'storageUpdate.lateWriteSuppressed'), " late suppressed")), buildMetricCard('Write queue backlog', storageQueueStallWarnings ? "".concat(storageQueueStallWarnings, " alert").concat(storageQueueStallWarnings === 1 ? '' : 's') : 'clear', storageQueueStallWarnings ? "Oldest pending write waited up to ".concat(formatDuration(storageQueueStallMaxWaitMs), " this epoch") : 'No sustained storage-update backlog this epoch', {
      alert: storageQueueStallWarnings > 0
    }), buildMetricCard('Timeout buckets', "".concat(storageTimeoutGet), "get ".concat(storageTimeoutGet, ", set ").concat(storageTimeoutSet, ", unknown ").concat(storageTimeoutUnknown)), buildMetricCard('No-work writes', "".concat(storageNoDurableWork), "".concat(storageNoRuntimeWork, " no runtime; ").concat(storageNoDurableWork, " no durable")), buildMetricCard('Storage queue wait', formatPhaseAverage(phases.storageQueueWait), formatPhaseDetail(phases.storageQueueWait)), buildMetricCard('Storage get', formatPhaseAverage(phases.storageGet), "".concat(getMetricCounter(counters, 'storageGetCalls'), " calls")), buildMetricCard('Storage set', formatPhaseAverage(phases.storageSet), "".concat(getMetricCounter(counters, 'storageSetCalls'), " calls")), buildMetricCard('Read payload avg', readCalls ? formatBytes(readBytes / readCalls) : '--', "".concat(formatBytes(readBytes), " total; max ").concat(formatBytes(readMaxBytes))), buildMetricCard('Read payload keys', formatBytes(readQueueBytes), "queue ".concat(formatBytes(readQueueBytes), ", view ").concat(formatBytes(readQueueViewBytes), ", progress ").concat(formatBytes(readProgressBytes))), buildMetricCard('Read hot path', topReadPath.path || '--', formatStoragePayloadPathDetail(topReadPath)), buildMetricCard('Payload avg', payloadCalls ? formatBytes(payloadBytes / payloadCalls) : '--', "".concat(formatBytes(payloadBytes), " total; max ").concat(formatBytes(payloadMaxBytes))), buildMetricCard('Payload sources', formatBytes(payloadQueueBytes), "queue ".concat(formatBytes(payloadQueueBytes), ", runs ").concat(formatBytes(payloadRunsBytes), ", progress ").concat(formatBytes(payloadProgressBytes))), buildMetricCard('Write hot path', topWritePath.path || '--', formatStoragePayloadPathDetail(topWritePath)), buildMetricCard('Milestone batch', milestoneFlushes ? formatRatio(milestoneReceived / milestoneFlushes) : '--', "".concat(milestoneReceived, " records / ").concat(milestoneFlushes, " flushes")), buildMetricCard('Progress events', "".concat(progressReceived), "pending max ".concat(progressPendingMax))], state.loading ? 'Loading history...' : 'No wakeup metrics yet.');
  }
  if (journal) {
    var recentEntries = _toConsumableArray(entries).sort(function (left, right) {
      return getTime(right) - getTime(left);
    }).slice(0, 30);
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
  card.className = options.alert ? 'metric-card metric-card--alert' : 'metric-card';
  var labelNode = document.createElement('div');
  labelNode.className = 'metric-label';
  labelNode.textContent = label;
  var valueNode = document.createElement('div');
  valueNode.className = 'metric-value';
  valueNode.textContent = value;
  var detailNode = document.createElement('div');
  detailNode.className = 'metric-detail';
  detailNode.textContent = detail;
  detailNode.title = detail;
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
  return Object.entries(counters || {}).filter(function (_ref9) {
    var _ref10 = _slicedToArray(_ref9, 1),
      key = _ref10[0];
    return key.startsWith(prefix);
  }).reduce(function (total, _ref11) {
    var _ref12 = _slicedToArray(_ref11, 2),
      value = _ref12[1];
    return total + (Number(value) || 0);
  }, 0);
}
function getTopStoragePayloadPath() {
  var counters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var direction = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'read';
  var normalizedDirection = direction === 'write' ? 'write' : 'read';
  var prefix = "storagePayload.".concat(normalizedDirection, ".path.");
  var suffix = '.bytes';
  var top = Object.entries(counters || {}).filter(function (_ref13) {
    var _ref14 = _slicedToArray(_ref13, 1),
      key = _ref14[0];
    return key.startsWith(prefix) && key.endsWith(suffix);
  }).map(function (_ref15) {
    var _ref16 = _slicedToArray(_ref15, 2),
      key = _ref16[0],
      value = _ref16[1];
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
  var entries = Object.entries(counters || {}).filter(function (_ref17) {
    var _ref18 = _slicedToArray(_ref17, 2),
      value = _ref18[1];
    return Number(value) !== 0;
  }).slice(0, 3).map(function (_ref19) {
    var _ref20 = _slicedToArray(_ref19, 2),
      key = _ref20[0],
      value = _ref20[1];
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
  return orderedEntries.slice(0, 14).map(function (_ref21) {
    var _ref22 = _slicedToArray(_ref21, 2),
      key = _ref22[0],
      value = _ref22[1];
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
  _fetchFlightRecorderForOutlier = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee21() {
    var rowKey,
      attemptId,
      result,
      entry,
      _entry,
      _args21 = arguments;
    return _regeneratorRuntime().wrap(function _callee21$(_context21) {
      while (1) switch (_context21.prev = _context21.next) {
        case 0:
          rowKey = _args21.length > 0 && _args21[0] !== undefined ? _args21[0] : '';
          attemptId = _args21.length > 1 && _args21[1] !== undefined ? _args21[1] : '';
          _context21.prev = 2;
          _context21.next = 5;
          return sendRuntimeMessageWithTimeout({
            action: 'get-flight-recorder',
            rowKey: rowKey,
            limit: 50
          }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS);
        case 5:
          result = _context21.sent;
          entry = state.outliers.find(function (item) {
            return item.rowKey === rowKey && item.attemptId === attemptId;
          });
          if (entry) entry.flightRecorderEntries = Array.isArray(result === null || result === void 0 ? void 0 : result.entries) ? result.entries : [];
          _context21.next = 14;
          break;
        case 10:
          _context21.prev = 10;
          _context21.t0 = _context21["catch"](2);
          _entry = state.outliers.find(function (item) {
            return item.rowKey === rowKey && item.attemptId === attemptId;
          });
          if (_entry) _entry.flightRecorderEntries = [];
        case 14:
          renderOutliers();
        case 15:
        case "end":
          return _context21.stop();
      }
    }, _callee21, null, [[2, 10]]);
  }));
  return _fetchFlightRecorderForOutlier.apply(this, arguments);
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
  if ("".concat((item === null || item === void 0 ? void 0 : item.status) || '') !== 'failed') return cell;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'clear-button row-action-button';
  button.textContent = 'Requeue';
  button.title = 'Reset and requeue this failed Current Work item';
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
  return getCurrentWorkSortRank(left) - getCurrentWorkSortRank(right) || getTime(right) - getTime(left) || "".concat(getQueueItemHref('', left) || (left === null || left === void 0 ? void 0 : left.storageKey) || (left === null || left === void 0 ? void 0 : left.id) || '').localeCompare("".concat(getQueueItemHref('', right) || (right === null || right === void 0 ? void 0 : right.storageKey) || (right === null || right === void 0 ? void 0 : right.id) || ''));
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
  return {
    title: getRunSourceLabel(run),
    subtitle: submittedLabel,
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
  } catch (_unused) {
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
  } catch (_unused2) {
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
  } catch (_unused3) {
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
  } catch (_unused4) {}
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
})();

/******/ })()
;