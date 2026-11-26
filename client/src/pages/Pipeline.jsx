import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import api from '../lib/api';

const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

function DraggableLead({ lead, onDragStart }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: lead.id.toString(),
    data: {
      status: lead.status,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border rounded-lg p-3 mb-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
    >
      <div {...attributes} {...listeners} className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-sm truncate max-w-[150px]">{lead.full_name}</h4>
        <GripVertical size={16} className="text-gray-400" {...onDragStart} />
      </div>
      <p className="text-xs text-gray-600 truncate mb-1">{lead.email}</p>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-500">{lead.phone}</span>
        <span className="text-xs text-gray-400">
          {lead.assigned_to_name || `ID: ${lead.id}`}
        </span>
      </div>
    </div>
  );
}

function DroppableColumn({ status, leads }) {
  const {
    setNodeRef,
    isOver,
    overId,
  } = useDroppable({
    id: status,
  });

  const isActive = isOver && overId !== status;

  return (
    <div
      ref={setNodeRef}
      className={`bg-gray-50 rounded-lg p-3 min-h-[200px] border-2 border-dashed ${isActive ? 'border-blue-400' : 'border-gray-200'}`}
    >
      {leads?.length === 0 ? (
        <p className="text-gray-400 text-center mt-8">Drop here</p>
      ) : (
        leads?.map((lead, index) => (
          <DraggableLead key={lead.id} lead={lead} />
        ))
      )}
    </div>
  );
}

export default function Pipeline() {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data } = await api.get('/leads');
      return data.leads || [];
    },
  });

  const [pipelineLeads, setPipelineLeads] = useState({});

  useEffect(() => {
    const grouped = {};
    STATUSES.forEach(status => {
      grouped[status] = leads.filter(lead => lead.status === status);
    });
    setPipelineLeads(grouped);
  }, [leads]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (!over) return;
    if (active.id === over.id) return;

    const sourceStatus = active.data.current?.status;
    const destStatus = over.id;

    if (sourceStatus === destStatus) return;

    try {
      await api.patch(`/leads/${active.id}`, { status: destStatus });
      setPipelineLeads(prev => {
        const newState = { ...prev };
        const sourceLeads = newState[sourceStatus];
        const destLeads = newState[destStatus];
        const movedLead = sourceLeads.find(lead => lead.id === active.id);

        newState[sourceStatus] = sourceLeads.filter(lead => lead.id !== active.id);
        newState[destStatus] = [...destLeads, movedLead];
        return newState;
      });
    } catch (error) {
      console.error('Failed to update lead status:', error);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: closestCenter,
    })
  );

  if (isLoading) return <div>Loading pipeline...</div>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Pipeline</h1>
      <div className="overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <DragOverlay>
            {({ isDragging, nodeRect, activatorRect, setRef }) => {
              if (!isDragging) return null;
              return null;
            }}
          </DragOverlay>
          <div className="flex gap-4 min-w-max">
            {STATUSES.map(status => (
              <div key={status} className="w-64 flex-shrink-0">
                <h3 className="font-semibold text-lg mb-2 capitalize border-b pb-2">
                  {status} ({pipelineLeads[status]?.length || 0})
                </h3>
                <DroppableColumn
                  status={status}
                  leads={pipelineLeads[status]}
                />
              </div>
            ))}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
