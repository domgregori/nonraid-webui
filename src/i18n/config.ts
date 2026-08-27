import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import activity from './locales/en/activity.json';
import app from './locales/en/app.json';
import apps from './locales/en/apps.json';
import auth from './locales/en/auth.json';
import browse from './locales/en/browse.json';
import common from './locales/en/common.json';
import dashboard from './locales/en/dashboard.json';
import diskDetail from './locales/en/diskDetail.json';
import docker from './locales/en/docker.json';
import layout from './locales/en/layout.json';
import lxc from './locales/en/lxc.json';
import onboarding from './locales/en/onboarding.json';
import pages from './locales/en/pages.json';
import settings from './locales/en/settings.json';
import shared from './locales/en/shared.json';
import shares from './locales/en/shares.json';
import state from './locales/en/state.json';
import users from './locales/en/users.json';

export const defaultNS = 'common';

export const resources = {
  en: {
    common,
    app,
    settings,
    dashboard,
    diskDetail,
    pages,
    shared,
    layout,
    browse,
    state,
    users,
    apps,
    lxc,
    onboarding,
    docker,
    shares,
    activity,
    auth,
  },
} as const;

// Only English ships today - this sets up the plumbing (namespaces, resource
// shape, useTranslation() call sites) so a second language is just a new
// `resources.<lng>` entry, not a rewrite of every component.
i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  ns: Object.keys(resources.en),
  defaultNS,
  interpolation: {
    escapeValue: false, // React already escapes - double-escaping breaks apostrophes etc.
  },
});

export default i18n;
