(function (root) {
    "use strict";

    var resumeAfterRun = false;

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
        resumeAfterRun = !!g.simulationRunning;

        // processFold mutates/triangulates the FOLD graph, so never hand the
        // caller's graph directly to the legacy pipeline.
        var graph = cloneFold(fold);
        g.foldUseAngles = true;

        // returnCreaseParams=true suppresses upload analytics and lets this
        // bridge explicitly build/sync the model in a deterministic order.
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
        if (!Number.isFinite(percent)) throw new RangeError("foldPercent must be finite.");
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
            verticesCoords.push([
                Number(positions[i]),
                Number(positions[i + 1]),
                Number(positions[i + 2])
            ]);
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
        if (resumeAfterRun) g.model.resume();
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
