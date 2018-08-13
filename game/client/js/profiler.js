window.ReboundProfiler = new (class {
    constructor() {
        this.process_stack = [];
        this.profiled_values = {};
    }

    begin(name) {
        this.process_stack.push([name, Date.now()]);
    }

    end() {
        const last = this.process_stack.pop();
        this.profiled_values[last[0]] = Date.now() - last[1];
    }

    log() {
        console.log("%c=== %cRebound Profiler %c===", "color: gray", "color: blue", "color: gray");

        Object.keys(this.profiled_values).sort((a, b) => this.profiled_values[b] - this.profiled_values[a]).forEach((proc_name, i) => {
            console.log(`${i + 1} | ${proc_name} = ${this.profiled_values[proc_name]}`);
        });
    }
})();