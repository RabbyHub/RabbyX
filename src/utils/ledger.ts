import { ledgerUSBVendorId } from '@ledgerhq/devices';
import { useCallback, useEffect, useState } from 'react';

export enum LedgerHDPathType {
  LedgerLive = 'LedgerLive',
  Legacy = 'Legacy',
  BIP44 = 'BIP44',
  Default = 'Default',
}

export const LedgerHDPathTypeLabel = {
  [LedgerHDPathType.LedgerLive]: 'Ledger Live',
  [LedgerHDPathType.BIP44]: 'BIP44',
  [LedgerHDPathType.Legacy]: 'Legacy',
  [LedgerHDPathType.Default]: 'Default',
};

export function useHIDDevices() {
  const [devices, setDevices] = useState<any[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  const fetchDevices = useCallback(() => {
    if (isFetching) return;

    setIsFetching(true);
    window.rabbyDesktop.ipcRenderer
      .invoke('get-hid-devices')
      .then((res: any) => {
        if (res?.error) {
          return;
        }
        setDevices(res?.devices);
      })
      .finally(() => {
        setIsFetching(false);
      });
  }, [setDevices, isFetching, setIsFetching]);

  useEffect(() => {
    fetchDevices();

    return window.rabbyDesktop.ipcRenderer.on(
      '__internal_push:webusb:device-changed',
      (event) => {
        fetchDevices();
      }
    );
  }, [fetchDevices]);

  return {
    isFetchingDevice: isFetching,
    devices,
    fetchDevices,
  };
}

export const useLedgerDeviceConnected = () => {
  const [connected, setConnected] = useState(false);

  const { devices, fetchDevices } = useHIDDevices();
  useEffect(() => {
    fetchDevices();
  }, []);
  useEffect(() => {
    const hasLedger = devices.some(
      (item) => item.vendorId === ledgerUSBVendorId
    );

    if (hasLedger) {
      setConnected(true);
    } else {
      setConnected(false);
    }
  }, [devices]);

  return connected;
};
