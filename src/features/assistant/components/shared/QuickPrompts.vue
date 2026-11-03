<template>
  <!-- 技能按钮：触发"加载 SKILL.md 并按模板执行"的完整分析流程。只保留最核心的
       几个技能，其余技能模型仍可经 skill 工具按需加载。 -->
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="s in skills"
      :key="`skill-${s.name}`"
      class="btn btn-secondary btn-outline btn-xs rounded-full kawaru-text-68"
      @click="$emit('skill', s.text)"
    >
      {{ skillLabels[s.name] ?? s.name }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** 技能按钮：name + 触发提示词 */
  skills: { name: string; text: string }[]
  /** 技能名 → 界面语言标签（缺省回退技能名本身） */
  skillLabels: Record<string, string>
}>()

defineEmits<{ skill: [text: string] }>()
</script>
