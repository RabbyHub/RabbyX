import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import './style.less';
import { openInternalPageInTab } from 'ui/utils';
import clsx from 'clsx';

interface QRCodeReaderProps {
  onSuccess(text: string): void;
  onError?(): void;
  width?: number;
  height?: number;
  isUR?: boolean;
  className?: string;
}

const QRCodeReader = ({
  onSuccess,
  onError,
  width = 100,
  height = 100,
  className,
}: QRCodeReaderProps) => {
  const [canplay, setCanplay] = useState(false);
  const codeReader = useMemo(() => {
    return new BrowserQRCodeReader();
  }, []);
  const videoEl = useRef<HTMLVideoElement>(null);
  const [deviceId, setDeviceId] = useState<string | null>();

  useEffect(() => {
    window.rabbyDesktop.ipcRenderer
      .invoke('rabbyx:get-selected-camera')
      .then((res: any) => {
        setDeviceId(res?.deviceId as string);
      });
  }, []);
  useEffect(() => {
    if (!deviceId) return;
    const videoElem = document.getElementById('video');
    const canplayListener = () => {
      setCanplay(true);
    };
    videoElem!.addEventListener('canplay', canplayListener);
    const promise = codeReader.decodeFromVideoDevice(
      deviceId,
      'video',
      (result) => {
        if (result) {
          onSuccess(result.getText());
        }
      }
    );
    return () => {
      videoElem!.removeEventListener('canplay', canplayListener);
      promise
        .then((controls) => {
          if (controls) {
            controls.stop();
          }
        })
        .catch(console.log);
    };
  }, [deviceId]);

  return (
    <video
      id="video"
      style={{
        display: canplay ? 'block' : 'none',
        width: `${width}px`,
        height: `${height}px`,
        filter: 'blur(4px)',
      }}
      ref={videoEl}
      className={clsx('qrcode-reader-comp', className)}
    ></video>
  );
};

export default QRCodeReader;
