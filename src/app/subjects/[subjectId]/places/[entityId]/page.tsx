import EntityDetail from '@/components/EntityDetail/EntityDetail';
import { loadEntityDetail } from '@/lib/loadEntityDetail';

export default async function PlaceDetailPage({
  params,
  searchParams,
}: {
  params: { subjectId: string; entityId: string };
  searchParams: { new?: string };
}) {
  const data = await loadEntityDetail(params.subjectId, 'place', params.entityId);
  return (
    <div className="app detail-app">
      <EntityDetail
        key={params.entityId}
        subjectId={params.subjectId}
        kind="place"
        isNew={searchParams.new === '1'}
        {...data}
      />
    </div>
  );
}
