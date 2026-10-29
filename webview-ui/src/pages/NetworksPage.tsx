import React, { useMemo, useState } from 'react';
import { Network, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  ActionPillButton,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

export const NetworksPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const { networks, operationInProgress } = useStudioStore();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [netName, setNetName] = useState('');
  const [netDriver, setNetDriver] = useState('bridge');
  const [netSubnet, setNetSubnet] = useState('');
  const [netInternal, setNetInternal] = useState(false);
  const [netIpv6, setNetIpv6] = useState(false);

  const busy = Boolean(operationInProgress);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return networks;
    }
    return networks.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.driver.toLowerCase().includes(q) ||
        n.subnets.some((s) => s.subnet.includes(q))
    );
  }, [networks, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Network
              className={`w-5 h-5 ${engine === 'podman' ? 'text-accent-purple' : 'text-accent-blue'}`}
            />
            <span>{fmt(t.networks.title, { engine: engineLabel })}</span>
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.networks.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.networks.createNetworkBtn}
            variant="brand"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(true)}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('networks:list')}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={t.networks.statConfigured}
            value={networks.length}
            detail={engine === 'podman' ? 'Netavark / Bridge' : 'Bridge / Overlay'}
          />
          <StatCard
            label={t.networks.statInternalDns}
            value={networks.filter((n) => n.dnsEnabled).length}
            detail={engine === 'podman' ? 'aardvark-dns' : 'Embedded Docker DNS'}
          />
          <StatCard
            label={t.networks.statCompose}
            value={networks.filter((n) => Boolean(n.composeProject)).length}
            detail={t.networks.statComposeDetail}
          />
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.networks.searchPlaceholder}
            className="input-field pl-9"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Network className="w-8 h-8" />}
            title={t.networks.emptyTitle}
            description={fmt(t.networks.emptyDesc, { engine: engineLabel })}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((n) => {
              const isDefault =
                n.name === 'podman' ||
                n.name === 'bridge' ||
                n.name === 'host' ||
                n.name === 'none';
              return (
                <div
                  key={n.id || n.name}
                  className="bg-panel-card border border-panel-border rounded-md px-4 py-3.5 flex items-center justify-between gap-4 shadow-card"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-text-primary font-mono">
                        {n.name}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-panel-bg border border-panel-border text-text-secondary">
                        {n.driver}
                      </span>
                      {n.dnsEnabled && (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/15 text-accent-green border border-accent-green">
                          {t.networks.dnsActiveBadge}
                        </span>
                      )}
                      {n.internal && (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-yellow-500/15 text-accent-orange border border-accent-orange">
                          {t.networks.internalBadge}
                        </span>
                      )}
                      {n.ipv6Enabled && (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/15 text-accent-purple border border-accent-purple">
                          IPv6
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary font-mono">
                      {t.networks.interfaceLabel}: {n.networkInterface || '-'} · {t.networks.subnetsLabel}:{' '}
                      {n.subnets.length > 0
                        ? n.subnets.map((s) => `${s.subnet} (gw ${s.gateway})`).join(', ')
                        : t.common.automatic}
                    </div>
                  </div>

                  <SmallActionButton
                    label={t.common.delete}
                    danger
                    disabled={busy || isDefault}
                    title={
                      isDefault
                        ? t.networks.defaultNetProtectedTooltip
                        : t.networks.removeNetworkTooltip
                    }
                    icon={<Trash2 className="w-3 h-3" />}
                    onClick={() => postMessage('network:remove', { networkName: n.name })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Network Modal */}
      {showCreate && (
        <Modal
          title={fmt(t.networks.createModalTitle, { engine: engineLabel })}
          subtitle={`${engineCmd} network create`}
          maxWidth="max-w-lg"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setShowCreate(false)} />
              <ActionPillButton
                label={t.networks.createNetworkBtn}
                variant="podman"
                disabled={!netName.trim()}
                onClick={() => {
                  postMessage('network:create', {
                    name: netName.trim(),
                    driver: netDriver,
                    subnet: netSubnet.trim() || undefined,
                    internal: netInternal,
                    ipv6: netIpv6,
                  });
                  setNetName('');
                  setNetSubnet('');
                  setShowCreate(false);
                }}
              />
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.networks.networkNameLabel}
              </label>
              <input
                type="text"
                value={netName}
                onChange={(e) => setNetName(e.target.value)}
                placeholder="backend-net"
                className="input-field font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t.networks.driverLabel}
                </label>
                <select
                  value={netDriver}
                  onChange={(e) => setNetDriver(e.target.value)}
                  className="input-field"
                >
                  <option value="bridge">bridge</option>
                  <option value="macvlan">macvlan</option>
                  <option value="ipvlan">ipvlan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t.networks.subnetCidrLabel}
                </label>
                <input
                  type="text"
                  value={netSubnet}
                  onChange={(e) => setNetSubnet(e.target.value)}
                  placeholder="10.89.10.0/24"
                  className="input-field font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={netInternal}
                  onChange={(e) => setNetInternal(e.target.checked)}
                />
                {t.networks.internalFlagLabel}
              </label>
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={netIpv6}
                  onChange={(e) => setNetIpv6(e.target.checked)}
                />
                {t.networks.ipv6FlagLabel}
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
