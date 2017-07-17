/* QQ 看点弹幕插件，依赖于类 jQuery 框架（zepto, jQuery）。
 * @desc 提供弹幕相关的一些原子操作，调用方可根据产品需求操作弹幕
 * @author gisonyang
 * @date 2017/07/11
 */

; (function () {
    'use strict';

    if (!Date.now)
        Date.now = function () { return new Date().getTime(); };

    var vendors = ['webkit', 'moz'];
    for (var i = 0; i < vendors.length && !window.requestAnimationFrame; ++i) {
        var vp = vendors[i];
        window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = (window[vp + 'CancelAnimationFrame']
                                   || window[vp + 'CancelRequestAnimationFrame']);
    }
    if (/iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent) // iOS6 is buggy
        || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
        var lastTime = 0;
        window.requestAnimationFrame = function (callback) {
            var now = Date.now();
            var nextTime = Math.max(lastTime + 16, now);
            return setTimeout(function () { callback(lastTime = nextTime); },
                              nextTime - now);
        };
        window.cancelAnimationFrame = clearTimeout;
    }
}());

; (function () {

    // 能力检查
    var _elementStyle = document.createElement('div').style;

    if (!('transform' in _elementStyle && 'webkitTransform' in _elementStyle)) {
        throw 'please use a modern browser'
    }

    var Barrage = function (option) {
        option = typeof option === 'undefined' ? {} : option;
        // 默认配置
        var _option = {
            container: '.comment-layer', // 弹幕容器
            /*
                mode 视频模式：'live'直播，'recorded'录播；
                live: 由调用方实时调用 add() 方法新增弹幕。
                recorded: 由插件控制弹幕的显示，调用方需调
                用 pushData() 方法按照一定规则添加弹幕。
            */
            mode: 'recorded',
            fontSize: 15, // 字体大小
            maxLength: 15, // 弹幕最大字数
            layout: 'half', // 布局方式：'top'三分之一, 'half'半屏, 'full'全屏
            line_height: 18, // 弹幕行高
            gapWidth: 15, // 每条弹幕空隙
            showTime: 3500, // 弹幕滚屏时间
        };

        for (var item in _option) {
            this[item] = option[item] == undefined ? _option[item] : option[item];
        }

        this.container = $(this.container);

        this.meta = {
            height: this.container.height(),
            width: this.container.width(),
        }
        var _layoutMap = {
            'top': 0.3333333333,
            'half': 0.5,
            'full': 1
        }

        // 弹幕行数
        this.rowNum = parseInt(this.meta.height * _layoutMap[this.layout] / this.line_height, 10);
        this.barragePool = {}; // 弹幕缓存池，存储变量到DOM的映射
        this.data = {}; // 弹幕data，key:seconds value:barrage array
        this.rowMeta = Array(this.rowNum); // 记录每行宽度，用于瀑布流排布
        this._resetZero(this.rowMeta);
        this.index = 0; // 弹幕ID下标
        this.timerId = null; // 弹幕轮询计时器ID
        this.tickId = null; // 弹幕rAF动画ID
        this.currentTime = 0; // 视频当前时间
        this.msDiff = this.container.width() / this.showTime; // 每毫秒位移
        this.diff = this.msDiff * 1000 / 60; // 每帧位移
        this.allDiff = 0; // 滚屏已经位移的距离

        this.init(); // 初始化位置

        // this.container.css({
        //     transition: 'transform ' + this.showTime/500 + 's linear',
        // })



    }

    Barrage.prototype = {
        _getValue: function (obj, defaultValue) {
            return obj === void 0 ? defaultValue : obj;
        },
        _typeof: function (data) {
            return Object.prototype.toString.call(data).match(/\[object (.*?)\]/)[1].toLowerCase();
        },
        _getDistance: function () {
            return this.container.width();
        },
        _randomRange: function(min, max) {
            return Math.floor(Math.random() * (max - min + 1) + min);
        },
        _createBarrage: function (opt) {
            var tpl = '<div id="b-comment-{{index}}" style="position: absolute; display: inline-block; white-space: pre; left: {{left}}px; top: {{top}}px; pointer-events: none; font-weight: bold; color: {{color}}; font-size: {{fontSize}}px; font-family: 黑体; opacity: 0.75; text-shadow: rgb(0, 0, 0) 1px 1px 2px;">{{text}}</div>'
            return tpl
                    .replace('{{index}}', opt.index)
                    .replace('{{left}}', opt.left || 0)
                    .replace('{{top}}', opt.top || 0)
                    .replace('{{color}}', opt.color || 'rgb(255,255,255)')
                    .replace('{{text}}', opt.text || 'rgb(255,255,255)')
                    .replace('{{fontSize}}', opt.fontSize || 15);
                
        },
        _resetZero: function(arr) {
            for (var i = 0; i < arr.length; i++) {
                arr[i] = 0;
            }
            return arr;
        },
        _findMinIndex: function () {
            var _rowMeta = this.rowMeta;
            var minIndex = 0;
            var minValue = _rowMeta[0];
            for (var i = 0; i < _rowMeta.length; i++) {
                if (_rowMeta[i] === 0) return i;
                if (_rowMeta[i] < minValue) {
                    minValue = _rowMeta[i];
                    minIndex = i;
                }
            }
            return minIndex;
        },
        _updateTime: function(isRestart) {
            if (this.mode !== 'recorded') return;

            var self = this;
            if (!isRestart) {
                this.showByTime(parseInt(this.currentTime, 10));
            }
            this.timerId = setTimeout(function() {
                self.currentTime += 1;
                self._updateTime();
            }, 1000);
        },
        _addDistanceForAll: function(diff) {
            this.allDiff += diff;
            for (var i = 0; i < this.rowMeta.length; i++) {
                this.rowMeta[i] = Math.max(this.rowMeta[i], this.allDiff);
            }
        },
        _safeTick: function() {
            if (this.tickId) window.cancelAnimationFrame(this.tickId);
            this._tick();
        },
        _tick: function() {
            // this.container.css('left', this.container.css('left').replace('px', '') - this.diff);
            this._addDistanceForAll(this.diff);
            this.container.css('transform', 'translateX(-' + this.allDiff + 'px)')
            this.tickId = window.requestAnimationFrame(this._tick.bind(this));
        },
        _timerForRemove: function(refIndex, isContinue) {
            var self = this;
            setTimeout(function() {
                if ( self._typeof(self.barragePool[refIndex]) === 'object' ) {
                    var currentLeft = self.barragePool[refIndex].dom.offset().left;
                    var width = self.barragePool[refIndex].width;
                    if ( -currentLeft >= width) {
                        self._deleteBarrage(refIndex);
                        self.stopAnimationWhenEmpty();
                    } else {
                        self._timerForRemove(refIndex, true);
                    }
                }
            }, isContinue ? 2500 : (this.showTime + 2500 + this._randomRange(0, 1500)));
        },
        _deleteBarrage: function(refIndex) {
            this.barragePool[refIndex].dom.remove();
            delete this.barragePool[refIndex];
        },
        init: function () {
            this.container.css('transform', 'translateX(0)')
        },
        add: function (text, opt) {

            if (text == null) return false;

            var ms = 0;
            if (this._typeof(text) === 'object') {
                ms = text.ms;
                text = text.tx;
            }
            
            var min = this._findMinIndex();
            var msDistance = (ms % 1000) * this.msDiff;
            opt = this._typeof(opt) === 'object' ? opt : {};
            // left = 当前宽度距离 + 毫秒位移 + 缝隙宽度
            opt.left = this.rowMeta[min] + msDistance + this.gapWidth;
            opt.top = min * this.line_height;
            opt.index = this.index++;
            opt.text = text;
            var br_dom = $(this._createBarrage(opt));
            this.container.append(br_dom);
            this.barragePool[opt.index] = { 
                dom: br_dom, 
                width: br_dom.width(), 
                rowIndex: min,
            };
            this.barragePool[opt.index].placeWidth = this.barragePool[opt.index].width + msDistance + this.gapWidth;
            this.rowMeta[min] += this.barragePool[opt.index].placeWidth;

            if (this.stopAnimation) {
                this.stopAnimation = false;
                this._safeTick();
            }

            this._timerForRemove(opt.index);
            return br_dom;
        },
        pushData: function (items, isCover) {
            var data = this.data;
            if (this._typeof(items) === 'array') {
                for(var i = 0; i < items.length; i++) {
                    var item = items[i];
                    if ( this._typeof(data[item.sec]) === 'array' ) {
                        data[item.sec] = data[item.sec].concat(item.bl);
                    } else if ( this._typeof(data[item.sec] === 'undefined') ) {
                        data[item.sec] = [].concat(item.bl);
                    }
                }
            } else if (this._typeof(items) === 'object') {
                if ( this._typeof(data[items.sec]) === 'array' ) {
                    data[items.sec] = isCover ? items.bl : data[items.sec].concat(items.bl);
                } else if ( this._typeof(data[items.sec] === 'undefined') ) {
                    data[items.sec] = [].concat(items.bl);
                }
            }
        },
        removeDataByTimeRange: function (minSeconds, maxSeconds) {
            var data = this.data;
            for (var i = minSeconds; i <= maxSeconds; i++) {
                data[i] = [];
            }
        },
        hasData: function(seconds) {
            if (this._typeof(this.data[seconds]) === 'undefined') return false;
            return !!this.data[seconds].length;
        },
        showByTime: function (seconds) {
            var items = this.data[seconds];
            if (this._typeof(this.data[seconds]) === 'array') {
                for (var i = 0; i < items.length; i++) {
                    this.add(items[i]);
                }
            }
        },
        setTime: function (seconds, isStart) {
            this.currentTime = seconds;
            clearTimeout(this.timerId);
            isStart && this._updateTime();
        },
        start: function() {
            this._updateTime();
            this._safeTick();
        },
        restart: function() {
            this._updateTime(true);
            this._safeTick();
        },
        stop: function(onlyAnimation) {
            window.cancelAnimationFrame(this.tickId);
            this.tickId = null;
            if (!onlyAnimation) {
                clearTimeout(this.timerId);
            }
        },
        reset: function() {
            this.init();
            this.container.empty();
            this.index = 0;
            this.barragePool = {};
            this.allDiff = 0;
            this._resetZero(this.rowMeta);
        },
        stopAnimationWhenEmpty: function() {
            if ($.isEmptyObject(this.barragePool)) {
                this.reset();
                this.stop(true);
                this.stopAnimation = true;
            }
        },
        removeNotEnter: function() {
            var barragePool = this.barragePool;
            for (var ref in barragePool) {
                if (barragePool[ref].dom.offset().left > this.meta.width) {
                    // 由于未进入，所以还需要减去宽度
                    this.rowMeta[barragePool[ref].rowIndex] -= barragePool[ref].placeWidth;
                    this._deleteBarrage(ref);
                }
            }
        },
        removeHasOut: function() {
            var barragePool = this.barragePool;
            for (var ref in barragePool) {
                if ( -barragePool[ref].dom.offset().left > barragePool[ref].width) {
                    this._deleteBarrage(ref);
                }
            }
        },
    }



    if (typeof module !== 'undefined' && typeof exports === 'object') {
        module.exports = Barrage;
    } else {
        window.Barrage = Barrage;
    }
})();