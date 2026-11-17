<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { getConfig } from '@/shared/config/runtimeConfig'
import { t } from '@/i18n'
import { getContent } from '@/features/home/config/contentConfig'

const year = new Date().getFullYear()
const config = getConfig()
const { contact } = getContent()

type SocialLink = { icon: string; label: string; href: string }

const socialLinks = computed<SocialLink[]>(
  () =>
    [
      contact.website && {
        icon: 'heroicons:globe-alt',
        label: t('home.footer.website'),
        href: contact.website,
      },
      contact.email && {
        icon: 'heroicons:envelope',
        label: t('home.footer.email'),
        href: `mailto:${contact.email}`,
      },
      contact.wechat && {
        icon: 'simple-icons:wechat',
        label: t('home.footer.wechat'),
        href: contact.wechat,
      },
      contact.github && {
        icon: 'simple-icons:github',
        label: t('home.footer.github'),
        href: contact.github,
      },
      contact.recruitment && {
        icon: 'heroicons:user-plus',
        label: t('home.footer.recruitment'),
        href: contact.recruitment,
      },
    ].filter(Boolean) as SocialLink[],
)

const poweredBy = computed(() => [
  {
    label: t('home.footer.computingFramework'),
    icon: 'heroicons:cpu-chip',
    href: 'https://github.com/NeoNexusX/MassFlow',
  },
  {
    label: t('home.footer.aliyun'),
    icon: 'simple-icons:alibabacloud',
    href: 'https://www.aliyun.com/',
  },
])
</script>

<template>
  <footer class="home-footer">
    <div class="home-footer__links">
      <nav class="home-footer__social">
        <a
          v-for="link in socialLinks"
          :key="link.href"
          :href="link.href"
          :aria-label="link.label"
          :data-tip="link.label"
          target="_blank"
          rel="noopener noreferrer"
          class="tooltip home-footer__icon"
        >
          <Icon :icon="link.icon" class="size-6" />
        </a>
      </nav>
      <div class="home-footer__support">
        <span>{{ $t('home.footer.poweredBy') }}</span>
        <nav class="flex items-center gap-1">
          <template v-for="item in poweredBy" :key="item.href">
            <a
              :href="item.href"
              :aria-label="item.label"
              :data-tip="item.label"
              target="_blank"
              rel="noopener noreferrer"
              class="tooltip home-footer__icon"
            >
              <Icon :icon="item.icon" class="size-6" />
            </a>
          </template>
        </nav>
      </div>
    </div>
    <p class="home-footer__legal">
      <span>{{ $t('home.footer.copyright', { year }) }}</span>
      <span v-if="config.version" class="home-footer__version">v{{ config.version }}</span>
    </p>
  </footer>
</template>

<style scoped>
.home-footer {
  margin-top: clamp(1.5rem, 4vh, 3rem);
  border-top: 1px solid var(--home-line);
  font-size: 0.8rem;
}
.home-footer__links,
.home-footer__legal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.home-footer__links {
  padding-block: 1rem;
}
.home-footer__social,
.home-footer__support {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.home-footer__support {
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}
.home-footer__icon {
  display: inline-grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  color: var(--color-base-content);
  transition:
    color 180ms ease,
    background 180ms ease;
}
.home-footer__icon:hover {
  color: var(--color-primary);
  background: var(--home-card);
}
.home-footer__icon:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.home-footer__legal {
  padding-top: 0.75rem;
  border-top: 1px solid var(--home-line);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}
.home-footer__version {
  font-variant-numeric: tabular-nums;
}
</style>
