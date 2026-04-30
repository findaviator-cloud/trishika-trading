import os from 'os';

function getSystemProfile() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuCount = os.cpus().length;

    const memUsage = 1 - (freeMem / totalMem);

    let mode = 'balanced';
    if (memUsage > 0.75) mode = 'conservative';
    else if (memUsage < 0.5) mode = 'performance';

    return {
        totalMem,
        freeMem,
        cpuCount,
        memUsage: Number(memUsage.toFixed(2)),
        mode
    };
}

export { getSystemProfile };
