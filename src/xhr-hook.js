export const REAL_XHR_KEY = '__xhr';
export const eventnames = {
	load: 'load',
	loadend: 'loadend',
	timeout: 'timeout',
	error: 'error',
	readystatechange: 'readystatechange',
	abort: 'abort'
};

export function unHook(iframeWindow) {
	const win = iframeWindow || window;

	// Restore XHR if needed, and clear up
	if (win[REAL_XHR_KEY]) {
		win.XMLHttpRequest = win[REAL_XHR_KEY];
	}
	win[REAL_XHR_KEY] = undefined;
}

export function hook(hookObj, iframeWindow) {
	const win = iframeWindow || window;

	// Keep original XHR and replace with new function
	win[REAL_XHR_KEY] = win[REAL_XHR_KEY] || win.XMLHttpRequest;
	win.XMLHttpRequest = function () {
		// Hook into XMLHttpRequest instead of its prototype, for some attributes are on itself.
		const realXhr = new win[REAL_XHR_KEY]();

		// Generate all callbacks(eg. onload) are enumerable (not undefined).
		for (let eventname of Object.values(eventnames)) {
			const key = `on${eventname}`;
			if (realXhr[key] === undefined) {
				realXhr[key] = null;
			}
		}

		// hook realXhr 对象上的所有属性和方法，如 hookObj 传入了 hookHandler ，则会优先执行该 hookHanlder
		for (let attr in realXhr) {
			let type = '';
			// May cause exception on some browser
			try {
				type = typeof realXhr[attr];
			} catch (e) {}

			if (type === 'function') {
				// hook methods such as `open`, `send` ...
				this[attr] = hookFunction(attr, hookObj);
			} else {
				// hook other properties and event handler properties such as: `onload`, `onreadystatechange` ...
				Object.defineProperty(this, attr, {
					get: getterFactory(attr, hookObj),
					set: setterFactory(attr, hookObj),
					enumerable: true
				});
			}
			const that = this;
			realXhr.getProxy = function () {
				return that;
			};
			this.realXhr = realXhr;
			Object.assign(win.XMLHttpRequest, {
				UNSENT: 0,
				OPENED: 1,
				HEADERS_RECEIVED: 2,
				LOADING: 3,
				DONE: 4
			});

			// Return the real XMLHttpRequest
			return win[REAL_XHR_KEY];
		}
	};

	// Hook methods of xhr.
	function hookFunction(funKey, hookObj) {
		return function () {
			var args = [].slice.call(arguments);
			const hookFun = hookObj[funKey];
			const realFun = this.realXhr[funKey];
			if (hookFun) {
				var ret = hookFun.call(this, args, this.realXhr);
				// If the hookObj return value exists, return it directly,
				// otherwise call the function of xhr.
				if (ret) return ret;
			}
			return realFun.apply(this.realXhr, args);
		};
	}

	// Generate getter for attributes of xhr
	function getterFactory(attr, hookObj) {
		return function () {
			var v = this.hasOwnProperty(attr + '_') ? this[attr + '_'] : this.realXhr[attr];
			var attrGetterHook = (hookObj[attr] || {})['getter'];
			return (attrGetterHook && attrGetterHook(v, this)) || v;
		};
	}

	// Generate setter for attributes of xhr; by this we have an opportunity
	// to hookAjax event callbacks （eg: `onload`） of xhr;
	function setterFactory(attr, hookObj) {
		return function (v) {
			var realXhr = this.realXhr;
			var that = this;
			var hook = proxy[attr];

			// hook event handlers such as `onload`、`onreadystatechange`...
			if (attr.substring(0, 2) === 'on') {
				that[attr + '_'] = v;
				realXhr[attr] = function (e) {
					e = configEvent(e, that);
					var ret = proxy[attr] && proxy[attr].call(that, realXhr, e);
					ret || v.call(that, e);
				};
			} else {
				//If the attribute isn't writable, generate proxy attribute
				var attrSetterHook = (hook || {})['setter'];
				v = (attrSetterHook && attrSetterHook(v, that)) || v;
				this[attr + '_'] = v;
				try {
					// Not all attributes of xhr are writable(setter may undefined).
					realXhr[attr] = v;
				} catch (e) {}
			}
		};
	}
}

export function configEvent(event, xhrProxy) {
	const e = {};
	for (let attr in event) {
		e[attr] = event[attr];
	}
	// xhrProxy instead
	e.target = e.currentTarget = xhrProxy;
	return e;
}
