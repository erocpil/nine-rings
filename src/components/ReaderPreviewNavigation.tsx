import { useEffect, useRef, useState } from "react";
import {
  readReaderExtras,
  saveReaderExtras,
  type ReaderExtras,
  type ReaderLocation,
} from "../lib/local-files/reader-extras";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import { ToolbarIcon } from "./ToolbarIcon";
export function useReaderPreviewNavigation(
  settings: BrowserSettingsStore,
  identity: string,
  fingerprint: string,
  locate: () => ReaderLocation,
  navigate: (location: ReaderLocation) => void,
) {
  const [extras, setExtras] = useState(() =>
    readReaderExtras(settings, identity, fingerprint),
  );
  const [notice, setNotice] = useState("");
  const live = useRef({
    settings,
    identity,
    fingerprint,
    locate,
    navigate,
    extras,
  });
  live.current = { settings, identity, fingerprint, locate, navigate, extras };
  const history = useRef<{ back: ReaderLocation[]; forward: ReaderLocation[] }>(
    { back: [], forward: [] },
  );
  const [, refresh] = useState(0);
  useEffect(() => {
    setExtras(readReaderExtras(live.current.settings, identity, fingerprint));
    history.current = { back: [], forward: [] };
    refresh((value) => value + 1);
  }, [identity, fingerprint]);
  const update = (patch: Partial<ReaderExtras>) => {
    const value = live.current,
      next = {
        ...(value.extras.fingerprint === value.fingerprint
          ? value.extras
          : readReaderExtras(
              value.settings,
              value.identity,
              value.fingerprint,
            )),
        ...patch,
        fingerprint: value.fingerprint,
      };
    try {
      if (value.fingerprint)
        saveReaderExtras(value.settings, value.identity, next);
      setExtras(next);
    } catch {
      setNotice("无法保存阅读设置，本次阅读仍可继续。");
      setExtras(next);
    }
  };
  const record = () => {
    const point = live.current.locate();
    const previous = history.current.back[history.current.back.length - 1];
    if (
      !previous ||
      previous.page !== point.page ||
      Math.abs(previous.top - point.top) > 2
    )
      history.current.back.push(point);
    history.current.back = history.current.back.slice(-50);
    history.current.forward = [];
    refresh((value) => value + 1);
  };
  const jump = (point: ReaderLocation) => {
    record();
    live.current.navigate(point);
  };
  const move = (back: boolean) => {
    const value = history.current,
      from = back ? value.back : value.forward,
      to = back ? value.forward : value.back;
    const point = from.pop();
    if (!point) return;
    to.push(live.current.locate());
    live.current.navigate(point);
    refresh((value) => value + 1);
  };
  const controls = (
    <div className="reader-preview-navigation">
      <button
        type="button"
        className="btn-icon"
        aria-label="返回阅读位置"
        title="返回跳转前的位置"
        disabled={!history.current.back.length}
        onClick={() => move(true)}
      >
        <ToolbarIcon name="chevronLeft" />
      </button>
      <button
        type="button"
        className="btn-icon"
        aria-label="前进阅读位置"
        title="前进到下一阅读位置"
        disabled={!history.current.forward.length}
        onClick={() => move(false)}
      >
        <ToolbarIcon name="chevronRight" />
      </button>
      <button
        type="button"
        className="btn-icon"
        disabled={!fingerprint}
        aria-label="添加阅读书签"
        title="保存当前阅读位置"
        onClick={() => {
          const point = live.current.locate();
          if (
            !extras.bookmarks.some(
              (item) =>
                item.page === point.page && Math.abs(item.top - point.top) < 20,
            )
          )
            update({ bookmarks: [...extras.bookmarks.slice(-99), point] });
        }}
      >
        <ToolbarIcon name="bookmark" />
      </button>
      <details>
        <summary>书签 · {extras.bookmarks.length}</summary>
        <div className="reader-bookmark-list">
          {extras.bookmarks.length === 0 && <span>暂无书签</span>}
          {extras.bookmarks.map((item, index) => (
            <div key={index}>
              <button type="button" onClick={() => jump(item)}>
                {item.label || `第 ${item.page} 页／章`}
              </button>
              <button
                type="button"
                aria-label={`删除阅读书签 ${index + 1}`}
                onClick={() =>
                  update({
                    bookmarks: extras.bookmarks.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </details>
      {notice && <span role="status">{notice}</span>}
    </div>
  );
  return { extras, update, jump, record, controls };
}
