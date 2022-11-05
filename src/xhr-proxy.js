import { unHook, hook, REAL_XHR_KEY, configEvent, eventnames } from './xhr-hook';

export function unProxy(iframeWindow) {
	unHook(iframeWindow);
}

// iframe.contentWindow 传入。注意：只能拦截同源的iframe页面（不能跨域）
export function proxy(proxyObj, iframeWindow) {
	const win = iframeWindow || window;

	if (win[REAL_XHR_KEY]) {
		throw 'Ajax is already hooked.';
	}
	return proxyAjax(proxyObj, win);
}

function proxyAjax(proxyObj, win) {
	const { onRequest, onResponse, onError } = proxyObj;

	function handleResponse(realXhr, xhrProxy) {
		var handler = new ResponseHandler(realXhr);
		var resObj = {
			response: xhrProxy.response || xhrProxy.responseText, //ie9
			status: xhrProxy.status,
			statusText: xhrProxy.statusText,
			config: realXhr.config,
			headers:
				realXhr.resHeader ||
				realXhr
					.getAllResponseHeaders()
					.split('\r\n')
					.reduce(function (ob, str) {
						if (str === '') return ob;
						var m = str.split(':');
						ob[m.shift()] = trim(m.join(':'));
						return ob;
					}, {})
		};
		if (!onResponse) {
			return handler.next(resObj);
		}
		onResponse(resObj, handler);
	}

	function onerror(xhr, xhrProxy, error, errorname) {
		var handler = new ErrorHandler(xhr);
		error = { config: xhr.config, error: error, type: errorname };
		if (onError) {
			onError(error, handler);
		} else {
			handler.next(error);
		}
	}

	function makeErrorCallback(errorname) {
		return function (xhr, e) {
			onerror(xhr, this, e, errorname);
			return true;
		};
	}

	function stateChangeCallback(realXhr, xhrProxy) {
		if (realXhr.readyState === 4 && realXhr.status !== 0) {
			handleResponse(realXhr, xhrProxy);
		} else if (realXhr.readyState !== 4) {
			triggerListener(realXhr, eventnames.readystatechange);
		}
		return true;
	}

	// hook 函数的第一个参数，是一个对象，其属性代表了需要对 XHR 拦截
	return hook(
		{
			// onload/onloadend 是事件处理函数，会通过事件触发来调用，
			// 因此返回 true ，防止调用 realXhr 上的方法
			onload: function preventRealXhrMethdCall() {
				return true;
			},
			onloadend: function preventRealXhrMethdCall() {
				return true;
			},
			onerror: makeErrorCallback(eventnames.error),
			ontimeout: makeErrorCallback(eventnames.timeout),
			onabort: makeErrorCallback(eventnames.abort),
			onreadystatechange: function (realXhr) {
				return stateChangeCallback(realXhr, this);
			},

			open(args, realXhr) {
				var _this = this;

				// hook open 方法的调用，并将相关参数记录下来，保存到 realXhr.config 对象上
				var config = (realXhr.config = { headers: {} });
				config.method = args[0];
				config.url = args[1];
				config.async = args[2];
				config.user = args[3];
				config.password = args[4];
				config.realXhr = realXhr;

				// 兼容未监听 'onreadystatechange' 的情况
				var handlerKey = 'on' + eventnames.readystatechange;
				if (!realXhr[handlerKey]) {
					realXhr[handlerKey] = function () {
						return stateChangeCallback(realXhr, _this);
					};
				}

				// TODO to dig deeper
				// 如有请求拦截器，则在调用onRequest后再打开链接。因为onRequest最佳调用时机是在send前，
				// 所以我们在send拦截函数中再手动调用open，因此返回true阻止xhr.open调用。
				// 如没有请求拦截器，则不用阻断xhr.open调用
				if (onRequest) return true;
			},
			send(args, realXhr) {
				var config = realXhr.config;
				config.withCredentials = realXhr.withCredentials;
				config.body = args[0];

				if (onRequest) {
					// In 'onRequest', we may call XHR's event handler, such as `xhr.onload`.
					// However, XHR's event handler may not be set until xhr.send is called in
					// the user's code, so we use `setTimeout` to avoid this situation
					var req = function () {
						onRequest(config, new RequestHandler(realXhr));
					};
					config.async === false ? req() : setTimeout(req);
					return true;
				}
			},
			setRequestHeader: function (args, realXhr) {
				realXhr.config.headers[args[0].toLowerCase()] = args[1];
				if (onRequest) return true;
			},
			addEventListener: function (args, realXhr) {
				var _this = this;
				if (eventnames.includes(args[0])) {
					var handler = args[1];
					getEventTarget(realXhr).addEventListener(args[0], function (e) {
						var event = configEvent(e, _this);
						event.type = args[0];
						event.isTrusted = true;
						handler.call(_this, event);
					});
					return true;
				}
			},
			getAllResponseHeaders: function (_, realXhr) {
				var headers = realXhr.resHeader;
				if (headers) {
					var header = '';
					for (var key in headers) {
						header += key + ': ' + headers[key] + '\r\n';
					}
					return header;
				}
			},
			getResponseHeader: function (args, realXhr) {
				var headers = realXhr.resHeader;
				if (headers) {
					return headers[(args[0] || '').toLowerCase()];
				}
			}
		},
		win
	);
}

function trim(str) {
	return str.replace(/^\s+|\s+$/g, '');
}

function getEventTarget(xhr) {
	return xhr.watcher || (xhr.watcher = document.createElement('a'));
}

function triggerListener(realXhr, eventname) {
	// 如用户有对事件处理函数赋值，则构造事件并调用该函数
	var xhrProxy = realXhr.getProxy();
	var callback = 'on' + eventname + '_';
	var event = configEvent({ type: eventname }, xhrProxy);
	xhrProxy[callback] && xhrProxy[callback](event);

	// 构造 event 对象，创建一个 DOM 元素并派发该对象
	var event;
	if (typeof Event === 'function') {
		event = new Event(eventname, { bubbles: false });
	} else {
		// https://stackoverflow.com/questions/27176983/dispatchevent-not-working-in-ie11
		event = document.createEvent('Event');
		event.initEvent(name, false, true);
	}
	getEventTarget(xhr).dispatchEvent(event);
}

function Handler(realXhr) {
	this.realXhr = realXhr;
	this.xhrProxy = realXhr.getProxy();
}

Handler.prototype = Object.create({
	resolve: function resolve(resObj) {
		var realXhr = this.realXhr;
		var xhrProxy = this.xhrProxy;

		realXhr.resHeader = resObj.headers;

		xhrProxy.readyState = 4;
		xhrProxy.response = xhrProxy.responseText = resObj.response;
		xhrProxy.statusText = resObj.statusText;
		xhrProxy.status = resObj.status;

		triggerListener(realXhr, eventnames.readystatechange);
		triggerListener(realXhr, eventnames.load);
		triggerListener(realXhr, eventnames.loadend);
	},
	reject: function reject(error) {
		this.xhrProxy.status = 0;
		var realXhr = this.realXhr;

		triggerListener(realXhr, error.type);
		triggerListener(realXhr, eventnames.loadend);
	}
});

// 利用了组合继承的特性，实际上最终使用的是 sub 函数的实例
function makeHandler(next) {
	function sub(realXhr) {
		Handler.call(this, realXhr);
	}

	sub.prototype = Object.create(Handler.prototype);
	sub.prototype.next = next;
	return sub;
}

var RequestHandler = makeHandler(function (reqConfig) {
	var realXhr = this.realXhr;
	reqConfig = reqConfig || realXhr.config;
	realXhr.withCredentials = reqConfig.withCredentials;
	realXhr.open(reqConfig.method, reqConfig.url, reqConfig.async !== false, reqConfig.user, reqConfig.password);
	for (var key in reqConfig.headers) {
		realXhr.setRequestHeader(key, reqConfig.headers[key]);
	}
	realXhr.send(reqConfig.body);
});

var ResponseHandler = makeHandler(function (response) {
	this.resolve(response);
});

var ErrorHandler = makeHandler(function (error) {
	this.reject(error);
});
