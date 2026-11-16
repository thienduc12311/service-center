import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('church applications and platform notices (source contract)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const tabs = read('app', '(tabs)', '_layout.tsx');
  const profile = read('app', '(tabs)', 'profile.tsx');
  const root = read('app', '_layout.tsx');
  const noChurch = read('src', 'components', 'church', 'NoChurchScreen.tsx');

  it('shows the application instead of empty tabs to someone with no church', () => {
    expect(tabs).toContain('if (session && ready && !organizationId) return <NoChurchScreen />;');
    expect(noChurch).toContain('<ChurchApplicationFlow hasChurch={false} />');
    expect(noChurch).toContain('<DisabledChurchNotice organization={organization} />');
    expect(noChurch).toContain("router.push('/delete-account')");
  });

  it('puts the admin-access and storage banners above the tabs', () => {
    expect(tabs.indexOf('<TabBanners />')).toBeLessThan(tabs.indexOf('<Tabs'));
    expect(tabs).toContain('<SafeAreaProvider style={styles.fill}>');
  });

  it('replaces direct church creation in Profile unless self-serve is allowed', () => {
    expect(profile).not.toContain('api.createOrganization');
    expect(profile).toContain("router.push('/church-application')");
    expect(profile).toContain('{selfServeChurches ? (\n                <CreateChurchForm />');
    expect(root).toContain('name="church-application"');
  });

  it('explains a logo refused by the media quota', () => {
    expect(profile).toContain('throw await explainDirectUploadError(error, () => api.organizationStorage())');
    expect(profile).toContain('{isAdmin(role) ? <StorageUsage /> : null}');
  });

  it('offers joining an existing church beside registering one, on the welcome screen only', () => {
    const joinFlow = read('src', 'components', 'church', 'ChurchJoinFlow.tsx');
    expect(noChurch).toContain("title={t('churchJoin.choice.join')}");
    expect(noChurch).toContain("title={t('churchJoin.choice.register')}");
    expect(noChurch).toContain("{choice === 'join' ? (");
    expect(noChurch).toContain('<ChurchJoinFlow />');
    expect(noChurch).toContain('queryKeys.churchJoinRequests(user?.profile.id)');
    expect(joinFlow).toContain('api.findChurchBySlug(slug)');
    expect(joinFlow).toContain('api.requestToJoinChurch(body)');
    expect(joinFlow).toContain('api.withdrawChurchJoinRequest(id)');
    // Profile's "Register another church" stays the application only.
    expect(profile).not.toContain('ChurchJoinFlow');
  });
});
