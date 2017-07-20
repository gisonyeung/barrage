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
        var self = this;
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
            layout: 'half', // 布局方式：'top'三分之一, 'half'半屏, 'full'全屏
            lineHeight: 18, // 弹幕行高
            fontSize: 15, // 弹幕字体大小 
            gapWidth: 15, // 每条弹幕空隙
            showTime: 3500, // 弹幕滚屏时间
            cleanSetSize: 10, // 清理集合分包大小，当指定条数展示完毕时，执行一次DOM清理
            maxLength: 30, // 弹幕长度限制，英文LEN=1 中文LEN=2，超过部分用...代替
            isHtmlEncode: true, // 是否转义 HTML 实体字符
            style: { // 普通弹幕样式
                color: '#ffffff',
                fontFamily: '黑体',
                opacity: '0.75',
                textShadow: 'rgb(0, 0, 0) 1px 1px 2px',
                fontWeight: 'bold',
            },
            self_style: { // 用户私有样式，覆盖通用样式同名项
                color: '#74bb4f',
            }
        };

        for (var item in _option) {
            this[item] = option[item] == undefined ? _option[item] : option[item];
        }

        if (this._typeof(option.style) === 'object') {
            for (var key in option.style) {
                _option.style[key] = option.style[key];
            }
            this.style = this._extend(_option.style);
        }

        if (this._typeof(option.self_style) === 'object') {
            var key;

            for (key in _option.self_style) {
                _option.style[key] = _option.self_style[key];
            }

            for (key in option.self_style) {
                _option.style[key] = option.self_style[key];
            }

            this.self_style = this._extend(_option.style);
        }

        _option = null;

        this.container = $(this.container);
        this.container.css('will-change', 'transform');

        this.meta = {
            height: this.container.height(),
            width: this.container.width(),
        }

        this._layoutMap = {
            'top': 0.3333333333,
            'half': 0.5,
            'full': 1
        }

        // 弹幕行数
        this.barragePool = {}; // 弹幕缓存池，存储变量到DOM的映射
        this.data = {}; // 弹幕data，key:seconds value:barrage array
        this.index = 0; // 弹幕ID下标
        this.timerId = null; // 弹幕轮询计时器ID
        this.tickId = null; // 弹幕rAF动画ID
        this.currentTime = 0; // 视频当前时间
        this.msDiff = this.container.width() / this.showTime; // 每毫秒位移
        this.diff = this.msDiff * 1000 / 60; // 每帧位移
        this.allDiff = 0; // 滚屏已经位移的距离
        this.deleteQueue = []; // 待删除弹幕索引队列
        this._updateRowMeta(); // 初始化行高行数信息
        this.playStatus = 0; // 播放状态

        this._init(); // 初始化位置

        $(window).on('resize', function() {
            self.setContainerSize({
                width: self.container.width(),
                height: self.container.height()
            })
        });

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
        _extend: function(o) {
            var new_obj = {};
            if (typeof(o) !== 'object') return new_obj;
            for (var k in o) {
                new_obj[k] = o;
            }
            return new_obj;
        },
        _createBarrage: function (opt, style) {
            var tpl = '<div id="b-comment-{{index}}" style="position: absolute; display: inline-block; white-space: pre; left: {{left}}px; top: {{top}}px; pointer-events: none; font-size: {{fontSize}}px; {{style_str}}">{{text}}</div>';
            tpl = tpl
                  .replace('{{index}}', opt.index)
                  .replace('{{left}}', opt.left || 0)
                  .replace('{{top}}', opt.top || 0)
                  .replace('{{fontSize}}', this.fontSize || 15)
                  .replace('{{text}}', opt.text);
            var _style;

            _style = (opt.isSelf == 1 || opt.isSelf === true) ? this.self_style : this.style;

            if (this._typeof(style) === 'object') {
                for (var k in style) _style[k] = style[k];
            }


            return tpl.replace('{{style_str}}', this._objToStyleStr(_style));
        },
        _resetZero: function(arr) {
            for (var i = 0; i < arr.length; i++) {
                arr[i] = 0;
            }
            return arr;
        },
        _objToStyleStr: function(obj) {
            var str = '';
            for (var key in obj) {
                str += key.replace(/[A-Z]/g, function(match) { return '-' + match.toLowerCase() }) + ':' + obj[key] + ';';
            };
            return str;
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
            if (this.timerId) clearTimeout(this.timerId);

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
            this.container.css('transform', 'translateX(-' + this.allDiff + 'px)');
            this.tickId = window.requestAnimationFrame(this._tick.bind(this));
            this._checkDeleteQueue(); // 检查待删除队列，看是否可以清理某些弹幕
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
        _enqueueToDelete: function(refIndex) {
            var queue = this.deleteQueue;

            if (queue.length > 0) {
                var lastQueue = queue[queue.length - 1];

                if (lastQueue.indexs.length < this.cleanSetSize) {
                    lastQueue.endDistance = Math.max(this.barragePool[refIndex].endDistance, lastQueue.endDistance);
                    lastQueue.indexs.push(refIndex);
                    lastQueue = null;
                    return;
                }
            }

            // queue 无元素或者 queue 里的索引数组长度大于 cleanSetSize，则直接 push 新数组
            queue.push({
                endDistance: this.barragePool[refIndex].endDistance,
                indexs: [refIndex],
            });
            queue = null;
        },
        _reDequeue: function() {
            this.deleteQueue = [];
            for (var refIndex in this.barragePool) {
                this._enqueueToDelete(refIndex);
            }
        },
        _checkDeleteQueue: function() {
            var queue = this.deleteQueue;
            if (queue.length > 0) {
                // 屏幕位移大于结束距离，则可以移除该队列
                if (this.allDiff > queue[0].endDistance + this.meta.width) {
                    for (var i = 0; i < queue[0].indexs.length; i++) {
                        this._deleteBarrage(queue[0].indexs[i]);
                    }
                    this.stopAnimationWhenEmpty();
                    queue.shift();
                }
            } else {
                this.stopAnimationWhenEmpty();
            }
            queue = null;
        },
        _htmlEncode: function(str) {
            return str.replace(/&/g,"&amp;")
                      .replace(/>/g,"&gt;")
                      .replace(/</g,"&lt;")
                      .replace(/"/g,"&quot;")
                      .replace(/'/g,"&#39;");
        },
        _cutString: function(str) {
            var realLength = 0, len = str.length, charCode = -1;
            var obj_str = '';
            var charLen = 0;

            for (var i = 0; i < len; i++) {
                charCode = str.charCodeAt(i);
                charLen = (charCode >= 0 && charCode <= 128) ? 1 : 2;;
                realLength += charLen;
                if (realLength < this.maxLength) {
                    obj_str += str[i];
                } else {
                    obj_str += '...';
                    return { realLen: realLength - charLen + 3, text: obj_str };
                }
            }

            return { realLen: realLength, text: obj_str };
        },
        _getBarrageWidth: function(len) {
            return len * this.fontSize / 16 * 8.3;
        },
        _init: function () {
            this.container.css('transform', 'translateX(0)');
        },
        _updateRowMeta: function() {
            // 弹幕行数
            this.rowNum = parseInt(this.meta.height * this._layoutMap[this.layout] / this.lineHeight, 10);
            this.rowMeta = Array(this.rowNum); // 记录每行宽度，用于瀑布流排布
            this._resetZero(this.rowMeta);
        },
        add: function (text, style, fragment) {

            if (text == null) return false;

            var ms = 0;
            var opt = {};

            if (this._typeof(text) === 'object') {
                ms = text.ms || 0;
                opt.isSelf = text.isSelf || 0;
                text = text.tx;
            }

            // 判断是否传入了 fragment，否则直接将弹幕 append 到弹幕容器
            fragment = this._typeof(fragment) === 'array' ? fragment : this.container;
            
            var min = this._findMinIndex();
            var msDistance = (ms % 1000) * this.msDiff;

            
            // left = 当前宽度距离 + 毫秒位移 + 缝隙宽度
            

            opt.left = this.rowMeta[min] + msDistance + this.gapWidth;
            opt.top = min * this.lineHeight;
            opt.index = this.index++;
            var cutResult = this._cutString(text);
            if (this.isHtmlEncode) {
                opt.text = this._htmlEncode(cutResult.text);
            }
            var br_dom = $(this._createBarrage(opt, style));
            fragment.append(br_dom);
            this.barragePool[opt.index] = { 
                dom: br_dom, 
                width: this._getBarrageWidth(cutResult.realLen) , 
                rowIndex: min,
            };
            this.barragePool[opt.index].placeWidth = this.barragePool[opt.index].width + msDistance + this.gapWidth;
            this.rowMeta[min] += this.barragePool[opt.index].placeWidth;
            this.barragePool[opt.index].endDistance = this.rowMeta[min];

            if (this.stopAnimation) {
                this.stopAnimation = false;
                this._safeTick();
            }

            this._enqueueToDelete(opt.index);

            // this._timerForRemove(opt.index);
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
                var fragment = $(document.createDocumentFragment());
                for (var i = 0; i < items.length; i++) {
                    this.add(items[i], undefined, fragment);
                }
                this.container.append(fragment);
                fragment = null;
            }
        },
        setTime: function (seconds) {
            this.currentTime = seconds;
            clearTimeout(this.timerId);
            if (this.playStatus === 1) {
                this._updateTime();
            }
        },
        setShowTime: function(ms) {
            this.showTime = ms;
            this.msDiff = this.container.width() / this.showTime; // 每毫秒位移
            this.diff = this.msDiff * 1000 / 60; // 每帧位移
        },
        start: function(isRestart) {
            this.playStatus = 1;
            this._updateTime(isRestart);
            this._safeTick();
        },
        stop: function(onlyAnimation) {
            window.cancelAnimationFrame(this.tickId);
            this.tickId = null;
            if (!onlyAnimation) {
                clearTimeout(this.timerId);
                this.playStatus = 0;
            }
        },
        clearBarrage: function() {
            this._init();
            this.container.empty();
            this.index = 0;
            this.barragePool = {};
            this.deleteQueue = [];
            this.allDiff = 0;
            this._updateRowMeta();
        },
        stopAnimationWhenEmpty: function() {
            if ($.isEmptyObject(this.barragePool)) {
                this.clearBarrage();
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
            this._reDequeue();
        },
        setContainerSize: function(size) {
            this.meta.height = size.height;
            this.meta.width = size.width;
            this.msDiff = size.width / this.showTime; // 每毫秒位移
            this.diff = this.msDiff * 1000 / 60; // 每帧位移
        },
        setProps: function(props) {
            if (this._typeof(props) !== 'object') return;

            if (props.fontSize && this.fontSize != props.fontSize) {
                this.container.children().each(function() {
                    $(this).css('font-size', parseInt(props.fontSize, 10) + 'px');
                });
            }
            this.fontSize = parseInt(props.fontSize, 10) || this.fontSize;
            this.gapWidth = parseInt(props.gapWidth, 10) || this.gapWidth;
            this.maxLength = parseInt(props.maxLength, 10) || this.maxLength;
        },
        reset: function(props) {
            this.clearBarrage();

            if (this._typeof(props) === 'object') {
                this.lineHeight = parseInt(props.lineHeight, 10) || this.lineHeight;
                this.layout = props.layout || this.layout;
                this._updateRowMeta();
            }
        },
        switch: function() {
            this.data = {};
            this.clearBarrage();
            this.setTime(0);
        },
        clearData: function() {
            this.data = {};
        },


        // removeHasOut: function() {
        //     var barragePool = this.barragePool;
        //     for (var ref in barragePool) {
        //         if ( -barragePool[ref].dom.offset().left > barragePool[ref].width) {
        //             this._deleteBarrage(ref);
        //         }
        //     }
        // },
    }

    if (typeof module !== 'undefined' && typeof exports === 'object') {
        module.exports = Barrage;
    } else {
        window.Barrage = Barrage;
    }
})();