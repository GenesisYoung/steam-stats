<template>
  <div class="flex min-h-screen flex-col items-center justify-center px-4 py-10">
    <RouterLink :to="{ name: 'landing' }" class="mb-8 flex items-center gap-2 text-lg font-semibold">
      <img src="/favicon.svg" alt="" class="h-9 w-9" />
      <span>Steam <span class="text-accent">Analytics</span></span>
    </RouterLink>
    <main class="card w-full max-w-md p-8">
      <RouterView />
    </main>
  </div>
</template>
