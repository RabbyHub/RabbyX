import walletController from "./wallet";

type LooseErrorObj = {
    code?: string;
    message?: string;
    stack?: string;
}
async function runAndCatchErr<T = any>(proc: Function, mark?: string): Promise<{
    result: T | null
    error?: LooseErrorObj
}> {
    try {
        console.debug('[debug] runAndCatchErr:: mark', mark);
        const result = await proc();
        // console.debug('[debug] runAndCatchErr:: result', result);

        return {
            result: result
        };
    } catch (err) {
        console.error(err)

        return {
            result: null,
            error: {
                code: (err as any).code,
                message: err.message,
                stack: err.stack,
            }
        };
    }
}

window.rabbyDesktop?.ipcRenderer.on('rabbyx-rpc-query', async (payload) => {
    if (!payload.rpcId) {
        throw new Error('[rabbyx-rpc-query] rpcId is required');
    }

    let retPayload = {
        result: null,
        error: null
    } as any;

    switch (payload.method) {
        case 'walletController.boot': {
            const [password] = payload.params;
            retPayload = await runAndCatchErr(() => {
                return walletController.boot(password);
            }, payload.method)
            break;
        }
        case 'walletController.isBooted': {
            retPayload = await runAndCatchErr(() => {
                return walletController.isBooted.apply(walletController);
            }, payload.method)
            break;
        }
        case 'walletController.isUnlocked': {
            retPayload = await runAndCatchErr(() => {
                return walletController.isUnlocked.apply(walletController);
            }, payload.method)
            break;
        }
        case 'walletController.lockWallet': {
            retPayload = await runAndCatchErr(() => {
                return walletController.lockWallet.apply(walletController);
            }, payload.method)
            break;
        }
        case 'walletController.unlock': {
            retPayload = await runAndCatchErr(() => {
                return walletController.unlock.apply(walletController, payload.params);
            }, payload.method)
            break;
        }
        case 'walletController.getConnectedSites': {
            retPayload = await runAndCatchErr(() => {
                return walletController.getConnectedSites.apply(walletController);
            }, payload.method)
            break;
        }
        case 'walletController.importPrivateKey': {
            retPayload = await runAndCatchErr(() => {
                const [password] = payload.params || [];
                return walletController.importPrivateKey.apply(walletController, [password]);
            }, payload.method)
            break;
        }
        case 'walletController.getAlianName': {
            retPayload = await runAndCatchErr(() => {
                const [address] = payload.params || [];
                return walletController.getAlianName.apply(walletController, [address]);
            }, payload.method)
            break;
        }
        case 'walletController.updateAlianName': {
            retPayload = await runAndCatchErr(() => {
                const [address, name] = payload.params || [];
                return walletController.updateAlianName.apply(walletController, [address, name]);
            }, payload.method)
            break;
        }
        default: {
            const [ns, method] = payload.method.split('.');

            if (ns === 'walletController' && typeof walletController[method] === 'function') {
                retPayload = await runAndCatchErr(() => {
                    return walletController[method].apply(walletController, payload.params);
                }, payload.method)
            } else {
                retPayload.error = {
                    message: `[rabbyx-rpc-query] method ${payload.method} is not supported`
                }
            }
        }
    }

    // console.debug('[debug] retPayload', retPayload);

    window.rabbyDesktop.ipcRenderer.sendMessage('rabbyx-rpc-respond', JSON.stringify({
        rpcId: payload.rpcId,
        result: retPayload?.result,
        error: retPayload?.error,
    }));
});