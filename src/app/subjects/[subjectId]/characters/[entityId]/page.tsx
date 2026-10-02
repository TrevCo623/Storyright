import EntityDetail from '@/components/EntityDetail/EntityDetail';
import { loadEntityDetail } from '@/lib/loadEntityDetail';

export default async function CharacterDetailPage({
  params,
  searchParams,
}: {
  params: { subjectId: string; entityId: string };
  searchParams: { new?: string };
}) {
  const data = await loadEntityDetail(params.subjectId, 'character', params.entityId);
  return (
    <div className="app detail-app">
      <EntityDetail
        key={params.entityId}
        subjectId={params.subjectId}
        kind="character"
        isNew={searchParams.new === '1'}
        {...data}
      />
    </div>
  );
}
