(function (root) {
    "use strict";

    var resumeAfterRun = false;
    var isHeadless = /(?:\?|&)model=__origami_lab_headless__(?:&|$)/.test(root.location.search);

    function requireGlobals() {
        var g = root.globals;
        if (!g || !g.model || !g.pattern || !g.dynamicSolver) {
            throw new Error("OrigamiSimulator legacy runtime is not ready.");
        }
        return g;
    }

    function cloneFold(fold) {
        return JSON.parse(JSON.stringify(fold));
    }

    function readResidualPercent() {
        var element = root.document && root.document.getElementById("globalError");
        if (!element) return undefined;
        var text = element.textContent || element.innerText || element.innerHTML || "";
        var value = parseFloat(text);
        return Number.isFinite(value) ? value : undefined;
    }

    function loadFold(fold) {
        var g = requireGlobals();
        resumeAfterRun = !isHeadless && !!g.simulationRunning;

        var graph = cloneFold(fold);
        g.foldUseAngles = true;

        var creaseParams = g.pattern.setFoldData(graph, false, true);
        if (!Array.isArray(creaseParams)) {
            throw new Error("Legacy FOLD preprocessing did not produce crease parameters.");
        }

        g.model.buildModel(g.pattern.getFoldData(), creaseParams);
        g.model.pause();
        g.model.sync();
        g.model.reset();
    }

    function setFoldPercent(percent) {
        if (!Number.isFinite(percent) || percent < -1 || percent > 1) {
            throw new RangeError("foldPercent must be finite and between -1 and 1.");
        }
        var g = requireGlobals();
        g.setCreasePercent(percent);
        g.shouldChangeCreasePercent = true;
    }

    function step(steps) {
        if (!Number.isInteger(steps) || steps < 0) {
            throw new RangeError("steps must be a non-negative integer.");
        }
        if (steps === 0) return;
        requireGlobals().model.step(steps);
    }

    function snapshot() {
        var g = requireGlobals();
        var positions = g.model.getPositionsArray();
        var verticesCoords = [];
        for (var i = 0; i < positions.length; i += 3) {
            var x = Number(positions[i]);
            var y = Number(positions[i + 1]);
            var z = Number(positions[i + 2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                throw new Error("Legacy solver produced non-finite vertex coordinates.");
            }
            verticesCoords.push([x, y, z]);
        }

        var result = {verticesCoords: verticesCoords};
        var residual = readResidualPercent();
        if (residual !== undefined) result.residual = residual;
        return result;
    }

    function reset() {
        requireGlobals().model.reset();
    }

    function release() {
        var g = requireGlobals();
        if (resumeAfterRun && !isHeadless) g.model.resume();
        resumeAfterRun = false;
    }

    root.origamiLabLegacyBridge = {
        backend: "legacy-webgl",
        residualUnit: "percent",
        isReady: function () {
            var g = root.globals;
            return !!(g && g.model && g.pattern && g.dynamicSolver);
        },
        loadFold: loadFold,
        setFoldPercent: setFoldPercent,
        step: step,
        snapshot: snapshot,
        reset: reset,
        release: release
    };
})(window);
