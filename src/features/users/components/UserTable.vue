<script setup lang="ts">
import type { AdminUser, UserListFilters } from '@/features/users/types/user'
import StatusBadge from '@/shared/components/StatusBadge.vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import { getRegionName } from '@/shared/utils/regionOptions'
import { identityLabel } from '@/features/users/utils/identityLabel'

defineProps<{
  users: AdminUser[]
  loading: boolean
  filters: UserListFilters
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  pageRange: (number | string)[]
}>()

defineEmits<{
  (e: 'search'): void
  (e: 'reset-filters'): void
  (e: 'open-drawer', user: AdminUser): void
  (e: 'go-to-page', page: number): void
  (e: 'change-size', size: number): void
}>()
</script>

<template>
  <div
    class="bg-base-100 rounded-2xl shadow-sm border border-base-200/60 flex flex-col overflow-hidden"
  >
    <div class="p-4 border-b border-base-200 flex flex-wrap items-center gap-3 bg-base-100">
      <SearchInput
        v-model="filters.username"
        :placeholder="$t('users.table.searchPlaceholder')"
        class="w-full sm:w-64"
        @search="$emit('search')"
      />

      <select
        v-model="filters.status"
        class="select select-bordered rounded-lg bg-base-100 font-normal kawaru-text-100 w-full sm:w-36"
      >
        <!-- value 是发给后端的筛选值，保持英文；只翻译显示文字 -->
        <option value="">{{ $t('users.table.allStatus') }}</option>
        <option value="Active">{{ $t('common.status.active') }}</option>
        <option value="Inactive">{{ $t('common.status.inactive') }}</option>
      </select>

      <input
        v-model="filters.institution"
        @keyup.enter="$emit('search')"
        type="text"
        :placeholder="$t('users.table.institutionPlaceholder')"
        class="input input-bordered rounded-lg bg-base-100 font-normal kawaru-text-100 w-full sm:w-44 focus:outline-none focus:border-primary/50"
      />

      <input
        v-model="filters.region"
        @keyup.enter="$emit('search')"
        type="text"
        :placeholder="$t('users.table.regionPlaceholder')"
        class="input input-bordered rounded-lg bg-base-100 font-normal kawaru-text-100 w-full sm:w-36 focus:outline-none focus:border-primary/50"
      />

      <div class="flex-1"></div>

      <button
        @click="$emit('search')"
        class="btn btn-primary rounded-lg font-medium shadow-sm flex-1 sm:flex-none kawaru-text-87"
      >
        {{ $t('common.action.search') }}
      </button>

      <button
        @click="$emit('reset-filters')"
        class="btn btn-outline border border-base-300 text-base-content/70 hover:bg-base-200 font-medium flex-1 sm:flex-none kawaru-text-87"
      >
        {{ $t('users.table.resetFilters') }}
      </button>
    </div>

    <!-- 手机端允许横向滚动：min-w 让表格保持可读列宽，而不是被压成几条竖线 -->
    <div class="overflow-x-auto w-full">
      <table class="table table-fixed w-full min-w-[640px]">
        <colgroup>
          <col style="width: 22%" />
          <col style="width: 12%" />
          <col style="width: 12%" />
          <col style="width: 24%" />
          <col style="width: 18%" />
          <col style="width: 12%" />
        </colgroup>
        <thead>
          <tr class="bg-base-200 text-base-content/60 border-b border-base-200 kawaru-text-112">
            <th class="font-medium py-3 px-4 text-center">{{ $t('common.field.username') }}</th>
            <th class="font-medium py-3 px-4 text-center">{{ $t('users.field.identity') }}</th>
            <th class="font-medium py-3 px-4 text-center">{{ $t('common.field.status') }}</th>
            <th class="font-medium py-3 px-4 text-center">{{ $t('users.field.institution') }}</th>
            <th class="font-medium py-3 px-4 text-center">{{ $t('common.field.region') }}</th>
            <th class="font-medium py-3 px-4 text-center">{{ $t('common.action.view') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && users.length === 0">
            <td colspan="6" class="py-20 text-center text-base-content/40 kawaru-text-112">
              <div class="flex flex-col items-center justify-center">
                <SvgIcon type="duplicate" class="h-10 w-10 mb-3 opacity-30" />
                <span>{{ $t('users.table.empty') }}</span>
              </div>
            </td>
          </tr>

          <template v-if="loading">
            <tr v-for="index in 3" :key="`skel-${index}`" class="border-b border-base-200/50">
              <td class="py-4 px-4 text-center"><div class="skeleton h-5 w-32 rounded mx-auto"></div></td>
              <td class="px-4 text-center"><div class="skeleton h-5 w-16 rounded-full mx-auto"></div></td>
              <td class="px-4 text-center"><div class="skeleton h-5 w-16 rounded-full mx-auto"></div></td>
              <td class="px-4 text-center"><div class="skeleton h-5 w-40 rounded mx-auto"></div></td>
              <td class="px-4 text-center"><div class="skeleton h-5 w-24 rounded mx-auto"></div></td>
              <td class="px-4 text-center">
                <div class="skeleton h-8 w-14 inline-block rounded-lg"></div>
              </td>
            </tr>
          </template>

          <template v-else>
            <tr
              v-for="user in users"
              :key="user.username"
              class="hover:bg-base-200/40 group transition-colors duration-150 border-b border-base-200/50 last:border-0 kawaru-text-112"
            >
              <td class="font-medium text-base-content py-4 px-4 text-center">{{ user.username }}</td>
              <td class="px-4 text-center">
                <span
                  class="badge badge-sm uppercase kawaru-text-62 font-medium border-0"
                  :class="
                    user.identity === 'admin'
                      ? 'bg-info/15 text-info'
                      : 'bg-success/15 text-success'
                  "
                >
                  {{ identityLabel(user.identity) }}
                </span>
              </td>
              <td class="px-4 text-center">
                <StatusBadge :status="user.active ? 'active' : 'inactive'" class="kawaru-text-100" />
              </td>
              <td class="text-base-content/80 px-4 text-center">{{ user.institution || '—' }}</td>
              <td class="text-base-content/80 px-4 text-center">{{ getRegionName(user.region) || '—' }}</td>
              <td class="px-4 text-center">
                <button
                  @click="$emit('open-drawer', user)"
                  class="btn btn-ghost border border-base-200/60 rounded-lg hover:bg-base-100 hover:border-base-300 bg-transparent kawaru-text-100 font-medium h-8 min-h-8
                    max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  {{ $t('common.action.view') }}
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <PaginationFooter
      variant="compact"
      :show-page-text="false"
      :current-page="currentPage"
      :total-pages="totalPages"
      :total-items="totalItems"
      :size="pageSize"
      :page-range="pageRange"
      @go-to-page="(p) => $emit('go-to-page', p)"
      @change-size="(s) => $emit('change-size', s)"
    />
  </div>
</template>
