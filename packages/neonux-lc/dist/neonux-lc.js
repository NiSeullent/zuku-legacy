/* Generated from NeonUX fbb3840af0076c580680fe9d8b90cf50a639ddc7; edit src/ and run build. */
/* NeonUX-LC 0.1.0 | Apache-2.0 | ES3 presentation enhancement only. */
(function (root) {
    var MAX_SURFACES = 4;
    var MAX_PRIMITIVES = 64;
    var MAX_WIDTH = 320;
    var MAX_HEIGHT = 160;
    var liveSurfaces = 0;

    function integer(value, min, max) {
        return typeof value === "number" && isFinite(value) &&
            Math.floor(value) === value && value >= min && value <= max;
    }

    function color(value) {
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
    }

    function modeFor(doc, options) {
        var requested = options && options.mode;
        var bodyMode = doc.body && doc.body.getAttribute("data-lc-mode");
        if (bodyMode === "text" || bodyMode === "low-power") {
            return bodyMode;
        }
        if (requested === "text" || requested === "low-power") {
            return requested;
        }
        return "auto";
    }

    function canvasContext(doc) {
        try {
            var probe = doc.createElement("canvas");
            if (probe.getContext) {
                return probe.getContext("2d");
            }
        } catch (ignore) {}
        return null;
    }

    function prepareVML(doc) {
        if (!doc.namespaces || !doc.createStyleSheet) {
            return false;
        }
        if (doc._neonuxLCVML !== undefined) {
            return doc._neonuxLCVML;
        }
        doc._neonuxLCVML = false;
        try {
            if (!doc.namespaces.nxlc) {
                doc.namespaces.add("nxlc", "urn:schemas-microsoft-com:vml");
            }
            var sheet = doc.createStyleSheet();
            sheet.addRule(".lc-vml", "behavior:url(#default#VML);display:block;position:absolute");
            var probe = doc.createElement("nxlc:shape");
            probe.className = "lc-vml";
            probe.style.behavior = "url(#default#VML)";
            doc._neonuxLCVML = typeof probe.adj === "object";
        } catch (ignore) {}
        return doc._neonuxLCVML;
    }

    function detect(doc) {
        doc = doc || root.document;
        var canvas = !!canvasContext(doc);
        return {
            dom: !!(doc && doc.createElement && doc.getElementsByTagName),
            canvas: canvas,
            vml: canvas ? false : prepareVML(doc),
            renderer: canvas ? "canvas" : (doc._neonuxLCVML ? "vml" : "dom")
        };
    }

    function fallback() {
        return {
            renderer: "dom",
            rect: function () { return false; },
            line: function () { return false; },
            clear: function () {},
            destroy: function () {}
        };
    }

    function surface(element, width, height, options) {
        if (!element || !element.ownerDocument ||
                !integer(width, 1, MAX_WIDTH) || !integer(height, 1, MAX_HEIGHT)) {
            return fallback();
        }
        var doc = element.ownerDocument;
        if (modeFor(doc, options) !== "auto") {
            if (element._neonuxLCSurface) {
                element._neonuxLCSurface.destroy();
            }
            return fallback();
        }
        if (element._neonuxLCSurface) {
            return element._neonuxLCSurface;
        }
        if (liveSurfaces >= MAX_SURFACES) {
            return fallback();
        }
        var support = detect(doc);
        var node;
        var context;
        if (support.renderer === "dom") {
            return fallback();
        }
        try {
            if (support.canvas) {
                node = doc.createElement("canvas");
                node.width = width;
                node.height = height;
                context = node.getContext("2d");
                if (!context) {
                    return fallback();
                }
            } else {
                node = doc.createElement("span");
            }
            node.className = "lc-graphic";
            node.setAttribute("aria-hidden", "true");
            node.style.position = "relative";
            node.style.display = "block";
            node.style.overflow = "hidden";
            node.style.width = width + "px";
            node.style.height = height + "px";
            element.appendChild(node);
        } catch (ignore) {
            return fallback();
        }
        liveSurfaces += 1;
        var count = 0;
        var destroyed = false;

        function vmlNode(tag) {
            var primitive = doc.createElement("nxlc:" + tag);
            primitive.className = "lc-vml";
            primitive.style.position = "absolute";
            return primitive;
        }

        var api = {
            renderer: support.renderer,
            rect: function (x, y, w, h, fill) {
                if (destroyed || count >= MAX_PRIMITIVES || !color(fill) ||
                        !integer(x, 0, width - 1) || !integer(y, 0, height - 1) ||
                        !integer(w, 1, width - x) || !integer(h, 1, height - y)) {
                    return false;
                }
                try {
                    if (context) {
                        context.fillStyle = fill;
                        context.fillRect(x, y, w, h);
                    } else {
                        var rectangle = vmlNode("rect");
                        rectangle.style.left = x + "px";
                        rectangle.style.top = y + "px";
                        rectangle.style.width = w + "px";
                        rectangle.style.height = h + "px";
                        rectangle.fillcolor = fill;
                        rectangle.stroked = false;
                        node.appendChild(rectangle);
                    }
                    count += 1;
                    return true;
                } catch (ignore) { return false; }
            },
            line: function (x1, y1, x2, y2, stroke, weight) {
                if (weight === undefined) { weight = 1; }
                if (destroyed || count >= MAX_PRIMITIVES || !color(stroke) ||
                        !integer(x1, 0, width) || !integer(y1, 0, height) ||
                        !integer(x2, 0, width) || !integer(y2, 0, height) ||
                        !integer(weight, 1, 4)) {
                    return false;
                }
                try {
                    if (context) {
                        context.strokeStyle = stroke;
                        context.lineWidth = weight;
                        context.beginPath();
                        context.moveTo(x1, y1);
                        context.lineTo(x2, y2);
                        context.stroke();
                    } else {
                        var segment = vmlNode("line");
                        segment.from = x1 + "," + y1;
                        segment.to = x2 + "," + y2;
                        segment.strokecolor = stroke;
                        segment.strokeweight = weight + "px";
                        node.appendChild(segment);
                    }
                    count += 1;
                    return true;
                } catch (ignore) { return false; }
            },
            clear: function () {
                if (destroyed) { return; }
                if (context) {
                    context.clearRect(0, 0, width, height);
                } else {
                    while (node.firstChild) { node.removeChild(node.firstChild); }
                }
                count = 0;
            },
            destroy: function () {
                if (destroyed) { return; }
                if (node.parentNode) { node.parentNode.removeChild(node); }
                destroyed = true;
                element._neonuxLCSurface = null;
                liveSurfaces -= 1;
            }
        };
        element._neonuxLCSurface = api;
        return api;
    }

    function init(doc, options) {
        doc = doc || root.document;
        var mode = modeFor(doc, options);
        var elements = doc.getElementsByTagName("div");
        var limit = Math.min(elements.length, 600);
        var enhanced = 0;
        var i;
        for (i = 0; i < limit; i += 1) {
            if (elements[i].getAttribute("data-lc-surface") === "status") {
                if (mode !== "auto") {
                    if (elements[i]._neonuxLCSurface) { elements[i]._neonuxLCSurface.destroy(); }
                } else if (enhanced < MAX_SURFACES) {
                    var graphic = surface(elements[i], 160, 36, options);
                    graphic.clear();
                    graphic.rect(0, 28, 160, 1, "#2a2f3a");
                    graphic.rect(0, 12, 8, 16, "#e91e63");
                    graphic.rect(14, 4, 8, 24, "#e91e63");
                    graphic.rect(28, 8, 8, 20, "#e91e63");
                    graphic.line(50, 18, 156, 18, "#9e9e9e", 1);
                    if (graphic.renderer !== "dom") { enhanced += 1; }
                }
            }
        }
        return { mode: mode, enhanced: enhanced };
    }

    root.NeonUXLC = { version: "0.1.0", detect: detect, surface: surface, init: init };
    function ready() { init(root.document); }
    if (root.document.readyState === "complete") {
        ready();
    } else if (root.addEventListener) {
        root.addEventListener("load", ready, false);
    } else if (root.attachEvent) {
        root.attachEvent("onload", ready);
    }
}(window));
