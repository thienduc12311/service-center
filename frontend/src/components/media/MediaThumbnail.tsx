import { useQuery } from '@tanstack/react-query';
import { FILE_DOWNLOAD_TTL_SECONDS } from '@service-center/shared';
import { keys } from '../../hooks/queries';
import { useQueryScope } from '../../hooks/scopedQuery';
import { api } from '../../lib/api';
import { Icon } from '../icons';

export interface MediaThumbnailProps {
  /** The bundle's thumbnail file; null or absent shows the media icon. */
  fileId: string | null | undefined;
  /** Describes the image for screen readers. */
  alt: string;
  className?: string;
}

/**
 * A media bundle's thumbnail, small. Without one (or while it loads, or when
 * the reader may not open the file) the media icon stands in, so the row
 * still reads as media.
 */
export const MediaThumbnail = ({ fileId, alt, className = 'h-8 w-12' }: MediaThumbnailProps) => {
  const { org, authorization } = useQueryScope();
  const url = useQuery({
    queryKey: [...keys.media(org), 'thumbnail', fileId, authorization] as const,
    queryFn: async () => (await api.fileDownload(fileId!, { disposition: 'inline' })).url,
    enabled: Boolean(org && fileId),
    // A download URL lives a minute; the browser keeps the image it loaded.
    staleTime: (FILE_DOWNLOAD_TTL_SECONDS - 10) * 1000,
    retry: false,
  });
  if (url.data) {
    return <img src={url.data} alt={alt} className={`${className} shrink-0 rounded object-cover ring-1 ring-app-border`} />;
  }
  return (
    <span role="img" aria-label={alt} className={`${className} inline-grid shrink-0 place-items-center rounded bg-sky-50 text-sky-600 ring-1 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300`}>
      <Icon name="media" className="size-4" />
    </span>
  );
};
