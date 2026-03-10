import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://spmsohpbhidyqyuprrjd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwbXNvaHBiaGlkeXF5dXBycmpkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTUxNTU4MSwiZXhwIjoyMDg3MDkxNTgxfQ.D99MtYt4BQTsDtKymg3ExpmIda62vQjMAiWXp58T-Ys'
);

const ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';
const EMAIL = 'admin@fullhouse.com.br';
const PASSWORD = 'Admin123456';

async function main() {
  console.log('=== Step 1: Diagnose current state ===');

  // Check existing auth users
  const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
  if (authErr) {
    console.error('Error listing auth users:', authErr.message);
  } else {
    console.log(`Auth users found: ${authUsers.users.length}`);
    authUsers.users.forEach(u => {
      console.log(`  - ${u.email} (id: ${u.id}, identities: ${u.identities?.length || 0})`);
    });
  }

  // Check profiles
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, name, role, organization_id');
  if (profErr) {
    console.error('Error listing profiles:', profErr.message);
  } else {
    console.log(`\nProfiles found: ${profiles.length}`);
    profiles.forEach(p => {
      console.log(`  - ${p.email} (id: ${p.id}, role: ${p.role}, org: ${p.organization_id})`);
    });
  }

  // Check organization
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', ORG_ID)
    .single();
  if (orgErr) {
    console.log(`\nOrganization ${ORG_ID}: NOT FOUND (${orgErr.message})`);
  } else {
    console.log(`\nOrganization: ${org.name} (id: ${org.id})`);
  }

  console.log('\n=== Step 2: Clean up existing user if needed ===');

  // Check if user with this email already exists in auth
  const existingUser = authUsers?.users?.find(u => u.email === EMAIL);
  if (existingUser) {
    console.log(`Deleting existing auth user ${EMAIL} (id: ${existingUser.id})...`);
    const { error: delErr } = await supabase.auth.admin.deleteUser(existingUser.id);
    if (delErr) {
      console.error('Error deleting user:', delErr.message);
    } else {
      console.log('Deleted successfully.');
    }
  }

  // Also clean up any other auth users that might be broken
  if (authUsers?.users) {
    for (const u of authUsers.users) {
      if (u.email !== EMAIL && (!u.identities || u.identities.length === 0)) {
        console.log(`Deleting broken auth user ${u.email} (no identities)...`);
        await supabase.auth.admin.deleteUser(u.id);
      }
    }
  }

  console.log('\n=== Step 3: Create new admin user via Auth Admin API ===');

  const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      role: 'admin',
      organization_id: ORG_ID,
    },
  });

  if (createErr) {
    console.error('Error creating user:', createErr.message);

    // If user already exists (maybe partial cleanup), try to update instead
    if (createErr.message.includes('already') || createErr.message.includes('duplicate')) {
      console.log('Trying to find and update existing user...');
      const { data: refreshedUsers } = await supabase.auth.admin.listUsers();
      const user = refreshedUsers?.users?.find(u => u.email === EMAIL);
      if (user) {
        const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
          password: PASSWORD,
          email_confirm: true,
          user_metadata: {
            role: 'admin',
            organization_id: ORG_ID,
          },
        });
        if (updateErr) {
          console.error('Error updating user:', updateErr.message);
          return;
        }
        console.log(`Updated user ${user.id} successfully.`);

        // Make sure profile exists
        const { error: profUpsertErr } = await supabase.from('profiles').upsert({
          id: user.id,
          email: EMAIL,
          name: 'admin',
          first_name: 'Admin',
          organization_id: ORG_ID,
          role: 'admin',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

        if (profUpsertErr) {
          console.error('Error upserting profile:', profUpsertErr.message);
        } else {
          console.log('Profile upserted successfully.');
        }
      }
    }
    return;
  }

  const userId = newUser.user.id;
  console.log(`User created: ${userId} (${EMAIL})`);
  console.log(`Identities: ${newUser.user.identities?.length || 0}`);

  console.log('\n=== Step 4: Create/Update profile ===');

  const { error: profileErr } = await supabase.from('profiles').upsert({
    id: userId,
    email: EMAIL,
    name: 'admin',
    first_name: 'Admin',
    organization_id: ORG_ID,
    role: 'admin',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (profileErr) {
    console.error('Error upserting profile:', profileErr.message);
  } else {
    console.log('Profile created/updated successfully.');
  }

  console.log('\n=== Step 5: Verify login works ===');

  const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  if (loginErr) {
    console.error('LOGIN TEST FAILED:', loginErr.message);
  } else {
    console.log('LOGIN TEST PASSED!');
    console.log(`Session token: ${loginData.session?.access_token?.substring(0, 20)}...`);
    // Sign out after test
    await supabase.auth.signOut();
  }

  console.log('\n=== DONE ===');
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('URL: https://nossocrm-five.vercel.app/login');
}

main().catch(console.error);
