/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { isSameMonth, isAfter } from 'date-fns';
import { parseAPITimestamp } from 'core/utils/date-formatters';
import { filterVersionHistory } from 'core/utils/client-count-utils';

import type AdapterError from '@ember-data/adapter';
import type FlagsService from 'vault/services/flags';
import type StoreService from 'vault/services/store';
import type VersionService from 'vault/services/version';
import type ClientsActivityModel from 'vault/models/clients/activity';
import type ClientsConfigModel from 'vault/models/clients/config';
import type ClientsVersionHistoryModel from 'vault/models/clients/version-history';
interface Args {
  activity: ClientsActivityModel;
  activityError?: AdapterError;
  config: ClientsConfigModel;
  endTimestamp: string; // ISO format
  mountPath: string;
  namespace: string;
  onFilterChange: CallableFunction;
  startTimestamp: string; // ISO format
  versionHistory: ClientsVersionHistoryModel[];
}

export default class ClientsCountsPageComponent extends Component<Args> {
  @service declare readonly flags: FlagsService;
  @service declare readonly version: VersionService;
  @service declare readonly store: StoreService;

  get formattedStartDate() {
    return this.args.startTimestamp ? parseAPITimestamp(this.args.startTimestamp, 'MMMM yyyy') : null;
  }

  // returns text for empty state message if noActivityData
  get dateRangeMessage() {
    if (this.args.startTimestamp && this.args.endTimestamp) {
      const endMonth = isSameMonth(
        parseAPITimestamp(this.args.startTimestamp) as Date,
        parseAPITimestamp(this.args.endTimestamp) as Date
      )
        ? ''
        : `to ${parseAPITimestamp(this.args.endTimestamp, 'MMMM yyyy')}`;
      // completes the message 'No data received from { dateRangeMessage }'
      return `from ${parseAPITimestamp(this.args.startTimestamp, 'MMMM yyyy')} ${endMonth}`;
    }
    return null;
  }

  get upgradeExplanations() {
    const { versionHistory, activity } = this.args;
    const upgradesDuringActivity = filterVersionHistory(versionHistory, activity.startTime, activity.endTime);
    if (upgradesDuringActivity.length) {
      return upgradesDuringActivity.map((upgrade: ClientsVersionHistoryModel) => {
        let explanation;
        const date = parseAPITimestamp(upgrade.timestampInstalled, 'MMM d, yyyy');
        const version = upgrade.version || '';
        switch (true) {
          case version.includes('1.9'):
            explanation =
              '- We introduced changes to non-entity token and local auth mount logic for client counting in 1.9.';
            break;
          case version.includes('1.10'):
            explanation = '- We added monthly breakdowns and mount level attribution starting in 1.10.';
            break;
          case version.includes('1.17'):
            explanation = '- We separated ACME clients from non-entity clients starting in 1.17.';
            break;
          default:
            explanation = '';
            break;
        }
        return `${version} (upgraded on ${date}) ${explanation}`;
      });
    }
    return null;
  }

  get versionText() {
    return this.version.isEnterprise
      ? {
          title: 'No billing start date found',
          message:
            'In order to get the most from this data, please enter your billing period start month. This will ensure that the resulting data is accurate.',
        }
      : {
          title: 'No start date found',
          message:
            'In order to get the most from this data, please enter a start month above. Vault will calculate new clients starting from that month.',
        };
  }

  get namespaces() {
    return this.args.activity.byNamespace
      ? this.args.activity.byNamespace.map((namespace) => ({
          name: namespace.label,
          id: namespace.label,
        }))
      : [];
  }

  get mountPaths() {
    if (this.namespaces.length) {
      return this.activityForNamespace?.mounts.map((mount) => ({
        id: mount.label,
        name: mount.label,
      }));
    }
    return [];
  }

  get startTimeDiscrepancy() {
    // show banner if startTime returned from activity log (response) is after the queried startTime
    const { activity, config } = this.args;
    const activityStartDateObject = parseAPITimestamp(activity.startTime) as Date;
    const queryStartDateObject = parseAPITimestamp(this.args.startTimestamp) as Date;
    const isEnterprise =
      this.args.startTimestamp === config.billingStartTimestamp?.toISOString() && this.version.isEnterprise;
    const message = isEnterprise ? 'Your license start date is' : 'You requested data from';

    if (
      isAfter(activityStartDateObject, queryStartDateObject) &&
      !isSameMonth(activityStartDateObject, queryStartDateObject)
    ) {
      return `${message} ${this.formattedStartDate}.
        We only have data from ${parseAPITimestamp(activity.startTime, 'MMMM yyyy')},
        and that is what is being shown here.`;
    } else {
      return null;
    }
  }

  get activityForNamespace() {
    const { activity, namespace } = this.args;
    return namespace ? activity.byNamespace.find((ns) => ns.label === namespace) : null;
  }

  get filteredActivity() {
    // return activity counts based on selected namespace and auth mount values
    const { namespace, mountPath, activity } = this.args;
    if (namespace) {
      return mountPath
        ? this.activityForNamespace?.mounts.find((mount) => mount.label === mountPath)
        : this.activityForNamespace;
    }
    return activity?.total;
  }

  get hasSecretsSyncClients(): boolean {
    const { activity } = this.args;
    // if there is any sync client data, show it
    return activity && activity?.total?.secret_syncs > 0;
  }

  @action
  onDateChange(params: { start_time: number | undefined; end_time: number | undefined }) {
    this.args.onFilterChange(params);
  }

  @action
  setFilterValue(type: 'ns' | 'mountPath', [value]: [string | undefined]) {
    const params = { [type]: value };
    // unset mountPath value when namespace is cleared
    if (type === 'ns' && !value) {
      params['mountPath'] = undefined;
    }
    this.args.onFilterChange(params);
  }

  @action resetFilters() {
    this.args.onFilterChange({
      start_time: undefined,
      end_time: undefined,
      ns: undefined,
      mountPath: undefined,
    });
  }
}
