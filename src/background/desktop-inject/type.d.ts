interface Window {
    rabbyDesktop: {
        ipcRenderer: {
            sendMessage<T extends string>(
                channel: T,
                ...args: any[]
            ): void;
            invoke<T extends any, U extends string>(
                channel: U,
                ...args: any[]
            ): Promise<T>;
            on: {
                <T extends string>(
                    channel: T,
                    func: (...args: any[]) => void
                ): (() => void) | undefined;
                <T extends string>(
                    channel: T,
                    func: (event: any) => void
                ): (() => void) | undefined;
            };
            once: {
                <T extends string>(
                    channel: T,
                    func: (...args: any[]) => void
                ): (() => void) | undefined;
                <T extends string>(
                    channel: T,
                    func: (event: any) => void
                ): (() => void) | undefined;
            };
        };
    };
}